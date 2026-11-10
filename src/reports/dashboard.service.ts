import { Injectable } from '@nestjs/common';
import {
  HealthFollowStatus, AssignmentKind, ChecklistReportStatus, LeaveStatus, MaintenanceStatus, MissionStatus, ReferralStatus, ReportStatus, Role, RoomType, Urgency,
} from '@prisma/client';
import { AuthUser } from '../common/auth-user';
import { dateOnly, todayTehran } from '../common/dates';
import { requireDormitory, requireUniversity } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_HEALTH: HealthFollowStatus[] = [HealthFollowStatus.OPEN, HealthFollowStatus.IN_PROGRESS];
const OPEN_MAINTENANCE: MaintenanceStatus[] = [MaintenanceStatus.SUBMITTED, MaintenanceStatus.APPROVED, MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.FIXED];

/** Role-specific summary cards. Plain count queries today; heavier analytics can move to read models later. */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  dashboard(actor: AuthUser) {
    switch (actor.role) {
      case Role.SUPER_ADMIN: return this.platform();
      case Role.SENIOR_ADMIN:
      case Role.SYSTEM_MANAGER: return this.manager(actor);
      case Role.DORM_SUPERVISOR: return this.supervisor(actor);
      case Role.ATTENDANT: return this.attendant(actor);
      case Role.SERVICE_STAFF: return this.service(actor);
      case Role.COUNSELING: return this.counseling(actor);
      case Role.HEALTH_LIAISON: return this.liaison(actor);
    }
  }

  private async platform() {
    const [universities, dormitories, users, students] = await Promise.all([
      this.prisma.university.count(), this.prisma.dormitory.count(), this.prisma.user.count({ where: { isActive: true } }), this.prisma.student.count(),
    ]);
    const healthIssuesOpen = await this.prisma.healthResult.count({ where: { followStatus: { in: OPEN_HEALTH } } });
    return { universities, dormitories, activeUsers: users, students, healthIssuesOpen };
  }

  private async manager(actor: AuthUser) {
    const universityId = requireUniversity(actor);
    const dorms = await this.prisma.dormitory.findMany({ where: { universityId, isActive: true }, select: { id: true } });
    const ids = dorms.map((d) => d.id);
    const [residents, beds, occupied, pendingLeaves, maintenance] = await Promise.all([
      this.prisma.assignment.count({ where: { endedAt: null, dormitoryId: { in: ids } } }),
      this.prisma.room.aggregate({ _sum: { capacity: true }, where: { type: RoomType.RESIDENTIAL, building: { dormitoryId: { in: ids } } } }),
      this.prisma.assignment.count({ where: { endedAt: null, kind: AssignmentKind.BED, dormitoryId: { in: ids } } }),
      this.prisma.leaveRequest.count({
        where: { universityId, status: actor.role === Role.SYSTEM_MANAGER ? LeaveStatus.PENDING_MANAGER : { in: [LeaveStatus.PENDING_SUPERVISOR, LeaveStatus.PENDING_MANAGER] } },
      }),
      this.prisma.maintenanceRequest.groupBy({ by: ['status'], where: { universityId, status: { in: OPEN_MAINTENANCE } }, _count: { _all: true } }),
    ]);
    const definedBeds = beds._sum.capacity ?? 0;
    const healthIssuesOpen = await this.prisma.healthResult.count({ where: { universityId, followStatus: { in: OPEN_HEALTH } } });
    return {
      healthIssuesOpen,
      dormitories: ids.length, residents, definedBeds, occupiedBeds: occupied, freeBeds: definedBeds - occupied,
      pendingLeaves, openMaintenance: Object.fromEntries(maintenance.map((m) => [m.status, m._count._all])),
    };
  }

  private async supervisor(actor: AuthUser) {
    const dormitoryId = requireDormitory(actor);
    const date = dateOnly(todayTehran());
    const [residents, beds, occupied, recorded, leaves, maintenance, referrals, onDuty, reports, checklists] = await Promise.all([
      this.prisma.assignment.count({ where: { endedAt: null, dormitoryId } }),
      this.prisma.room.aggregate({ _sum: { capacity: true }, where: { type: RoomType.RESIDENTIAL, building: { dormitoryId } } }),
      this.prisma.assignment.count({ where: { endedAt: null, kind: AssignmentKind.BED, dormitoryId } }),
      this.prisma.attendanceRecord.count({ where: { dormitoryId, date } }),
      this.prisma.leaveRequest.count({ where: { dormitoryId, status: LeaveStatus.PENDING_SUPERVISOR } }),
      this.prisma.maintenanceRequest.groupBy({ by: ['status'], where: { dormitoryId, status: { in: OPEN_MAINTENANCE } }, _count: { _all: true } }),
      this.prisma.referral.count({ where: { dormitoryId, status: ReferralStatus.SUBMITTED } }),
      this.prisma.staffPresence.count({ where: { dormitoryId, checkOutAt: null } }),
      this.prisma.dormReport.count({ where: { dormitoryId, status: ReportStatus.SUBMITTED } }),
      this.prisma.checklistReport.count({ where: { dormitoryId, status: ChecklistReportStatus.SUBMITTED } }),
    ]);
    const defined = beds._sum.capacity ?? 0;
    const healthIssuesOpen = await this.prisma.healthResult.count({ where: { dormitoryId, followStatus: { in: OPEN_HEALTH } } });
    return {
      healthIssuesOpen,
      residents, definedBeds: defined, occupiedBeds: occupied, freeBeds: defined - occupied,
      attendance: { recordedToday: recorded, residents }, leavesToDecide: leaves,
      openMaintenance: Object.fromEntries(maintenance.map((m) => [m.status, m._count._all])),
      referralsToDecide: referrals, staffOnDuty: onDuty, reportsToReview: reports, checklistsToApprove: checklists,
    };
  }

  private async attendant(actor: AuthUser) {
    const dormitoryId = requireDormitory(actor);
    const now = new Date();
    const date = dateOnly(todayTehran());
    const [open, shifts, unread, recorded, residents] = await Promise.all([
      this.prisma.staffPresence.findFirst({ where: { userId: actor.id, checkOutAt: null }, select: { id: true, checkInAt: true } }),
      this.prisma.shift.findMany({ where: { userId: actor.id, cancelledAt: null, endsAt: { gte: now }, startsAt: { lte: new Date(now.getTime() + 24 * 3_600_000) } }, orderBy: { startsAt: 'asc' }, select: { id: true, dormitoryId: true, startsAt: true, endsAt: true, type: true } }),
      this.prisma.messageRecipient.count({ where: { userId: actor.id, readAt: null, batch: { inApp: true, status: { in: ['QUEUED', 'COMPLETED'] } } } }),
      this.prisma.attendanceRecord.count({ where: { dormitoryId, date } }),
      this.prisma.assignment.count({ where: { endedAt: null, dormitoryId } }),
    ]);
    return { checkedIn: !!open, openPresence: open, upcomingShifts: shifts, unreadMessages: unread, attendance: { recordedToday: recorded, residents } };
  }

  private async service(actor: AuthUser) {
    const date = dateOnly(todayTehran());
    const [submitted, missions, unread] = await Promise.all([
      this.prisma.checklistReport.count({ where: { reporterId: actor.id, date } }),
      this.prisma.mission.count({ where: { assigneeId: actor.id, status: MissionStatus.ASSIGNED } }),
      this.prisma.messageRecipient.count({ where: { userId: actor.id, readAt: null, batch: { inApp: true, status: { in: ['QUEUED', 'COMPLETED'] } } } }),
    ]);
    return { checklistsSubmittedToday: submitted, openMissions: missions, unreadMessages: unread };
  }

  private async counseling(actor: AuthUser) {
    const universityId = requireUniversity(actor);
    const [byStatus, urgentUnreceived, upcoming] = await Promise.all([
      this.prisma.referral.groupBy({ by: ['status'], where: { universityId, status: { in: [ReferralStatus.APPROVED, ReferralStatus.RECEIVED, ReferralStatus.SCHEDULED] } }, _count: { _all: true } }),
      this.prisma.referral.count({ where: { universityId, urgency: Urgency.URGENT, status: { in: [ReferralStatus.SUBMITTED, ReferralStatus.APPROVED] } } }),
      this.prisma.psychologistSchedule.count({ where: { universityId, endsAt: { gte: new Date() } } }),
    ]);
    return { referrals: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])), urgentWaiting: urgentUnreceived, upcomingPsychologistVisits: upcoming };
  }

  private async liaison(actor: AuthUser) {
    const universityId = requireUniversity(actor);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [week, withIssues, open] = await Promise.all([
      this.prisma.healthInspection.count({ where: { universityId, inspectorId: actor.id, inspectedAt: { gte: weekAgo } } }),
      this.prisma.healthInspection.count({ where: { universityId, inspectorId: actor.id, inspectedAt: { gte: weekAgo }, issueCount: { gt: 0 } } }),
      this.prisma.healthResult.count({ where: { universityId, followStatus: { in: OPEN_HEALTH } } }),
    ]);
    return { inspectionsThisWeek: week, inspectionsWithIssuesThisWeek: withIssues, healthIssuesOpen: open };
  }
}
