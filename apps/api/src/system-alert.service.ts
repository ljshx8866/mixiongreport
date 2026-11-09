import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { alertFingerprint, cleanAlertMessage, diagnoseAlert } from './system-alert-diagnostics';

@Injectable()
export class SystemAlertService {
  private readonly logger = new Logger(SystemAlertService.name);
  constructor(private readonly db: PrismaService) {}

  async list(statusInput: unknown, pageInput: unknown, pageSizeInput: unknown) {
    const allowedStatuses = new Set(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']);
    const status = typeof statusInput === 'string' && allowedStatuses.has(statusInput) ? statusInput : undefined;
    const page = Math.max(1, Math.floor(Number(pageInput) || 1));
    const pageSize = Math.min(100, Math.max(10, Math.floor(Number(pageSizeInput) || 20)));
    const where = status ? { status } : {};
    const [rows, total] = await Promise.all([
      this.db.systemAlert.findMany({ where, orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.db.systemAlert.count({ where }),
    ]);
    return { items: rows.map((row) => ({ ...row, id: Number(row.id) })), total, page, pageSize };
  }

  async setStatus(idInput: unknown, statusInput: unknown) {
    const id = Number(idInput);
    if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('告警编号无效');
    const status = String(statusInput ?? '');
    if (!['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) throw new BadRequestException('告警状态无效');
    const existing = await this.db.systemAlert.findUnique({ where: { id: BigInt(id) }, select: { id: true } });
    if (!existing) throw new NotFoundException('告警记录不存在');
    const updated = await this.db.systemAlert.update({ where: { id: BigInt(id) }, data: { status } });
    return { ...updated, id: Number(updated.id) };
  }

  @Cron('*/5 * * * *')
  async collectFailedPosSyncLogs() {
    if (process.env.REPORT_SOURCE !== 'database') return;
    try {
      const failures = await this.db.apiSyncLog.findMany({
        where: { status: 'FAILED', alertedAt: null },
        orderBy: { id: 'asc' }, take: 100,
        select: { id: true, storeId: true, apiType: true, errorMessage: true, startedAt: true, store: { select: { storeName: true } } },
      });
      for (const failure of failures) {
        const rawMessage = `${failure.store.storeName} · ${failure.apiType}: ${failure.errorMessage ?? '未提供错误说明'}`;
        const message = cleanAlertMessage(rawMessage);
        const diagnosis = diagnoseAlert(message);
        const fingerprint = alertFingerprint('POS_SYNC', failure.storeId, failure.apiType, message);
        await this.db.$transaction(async (tx) => {
          await tx.systemAlert.upsert({
            where: { fingerprint },
            create: { fingerprint, source: 'POS_SYNC', severity: 'ERROR', status: 'OPEN', title: diagnosis.title,
              message, method: null, route: failure.apiType, suggestion: diagnosis.suggestion,
              firstSeenAt: failure.startedAt, lastSeenAt: failure.startedAt },
            update: { lastSeenAt: failure.startedAt, occurrenceCount: { increment: 1 }, status: 'OPEN', suggestion: diagnosis.suggestion },
          });
          await tx.apiSyncLog.update({ where: { id: failure.id }, data: { alertedAt: new Date() } });
        });
      }
    } catch (error) {
      this.logger.error(`Failed to scan POS sync logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
