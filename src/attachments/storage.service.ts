import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, promises as fs } from 'fs';
import { join } from 'path';

/**
 * Local-disk storage behind a tiny interface. Swap the body of these three methods for S3/MinIO
 * when the deployment needs shared storage; callers only deal with opaque storage keys.
 */
@Injectable()
export class StorageService {
  private dir: string;
  constructor(config: ConfigService) {
    this.dir = config.get<string>('UPLOAD_DIR') ?? './uploads';
  }
  async save(key: string, data: Buffer) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(join(this.dir, key), data, { flag: 'wx' });
  }
  stream(key: string) {
    return createReadStream(join(this.dir, key));
  }
  async remove(key: string) {
    await fs.rm(join(this.dir, key), { force: true });
  }
}
