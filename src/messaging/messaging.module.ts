import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { SmsWorker } from './sms-worker.service';
import { ISmsProvider, KavenegarSmsProvider, LogSmsProvider, SMS_PROVIDER } from './sms/sms-provider';

@Global()
@Module({
  controllers: [MessagingController],
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (c: ConfigService): ISmsProvider =>
        c.get('SMS_PROVIDER') === 'kavenegar'
          ? new KavenegarSmsProvider(c.getOrThrow<string>('KAVENEGAR_API_KEY'), c.get<string>('KAVENEGAR_SENDER'))
          : new LogSmsProvider(),
    },
    MessagingService,
    SmsWorker,
  ],
  exports: [SmsWorker],
})
export class MessagingModule {}
