import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { LocalStorageDriver } from './local-storage.driver.js';
import { S3StorageDriver } from './s3-storage.driver.js';
import { StorageService } from './storage.service.js';

export function createStorage(config: AppConfig): StorageService {
  const { storage } = config;
  return storage.driver === 's3'
    ? new S3StorageDriver(storage.s3)
    : new LocalStorageDriver(storage.photosDir);
}

@Module({
  providers: [
    { provide: StorageService, inject: [AppConfig], useFactory: createStorage },
  ],
  exports: [StorageService],
})
export class StorageModule {}
