import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { NotFoundException } from '@nestjs/common';
import type { S3Settings } from '../config/settings.js';
import { assertValidStorageKey } from './storage-key.js';
import { StorageService } from './storage.service.js';

const NOT_FOUND_ERROR_NAMES = new Set(['NoSuchKey', 'NotFound']);

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (NOT_FOUND_ERROR_NAMES.has(error.name) ||
      error.$metadata.httpStatusCode === 404)
  );
}

export function s3ClientConfig(settings: S3Settings): S3ClientConfig {
  const credentials =
    settings.accessKeyId && settings.secretAccessKey
      ? {
          accessKeyId: settings.accessKeyId,
          secretAccessKey: settings.secretAccessKey,
        }
      : undefined;
  return {
    region: settings.region,
    endpoint: settings.endpoint ?? undefined,
    forcePathStyle: settings.forcePathStyle,
    credentials,
  };
}

export class S3StorageDriver extends StorageService {
  private readonly bucket: string;

  constructor(
    settings: S3Settings,
    private readonly client: S3Client = new S3Client(s3ClientConfig(settings)),
  ) {
    super();
    this.bucket = settings.bucket;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ContentLength: data.length,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const output = await this.getObject(key);
    if (!output.Body) {
      throw new NotFoundException('File not found');
    }
    return Buffer.from(await output.Body.transformToByteArray());
  }

  async getStream(key: string): Promise<Readable> {
    const output = await this.getObject(key);
    if (!(output.Body instanceof Readable)) {
      throw new NotFoundException('File not found');
    }
    return output.Body;
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  private async getObject(key: string): Promise<GetObjectCommandOutput> {
    assertValidStorageKey(key);
    try {
      return await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new NotFoundException('File not found');
      }
      throw error;
    }
  }
}
