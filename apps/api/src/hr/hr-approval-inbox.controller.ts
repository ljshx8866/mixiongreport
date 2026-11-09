import { BadRequestException, Body, Controller, Get, HttpException, Logger, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrBankChangeService } from './hr-bank-change.service';
import { HrMonthlyReviewService } from './hr-monthly-review.service';
import { HrOffboardingService } from './hr-offboarding.service';
import { HrOnboardingService } from './hr-onboarding.service';
import { HrSalaryService } from './hr-salary.service';
import { HrTimeCorrectionService } from './hr-time-correction.service';
import { HrTransferService } from './hr-transfer.service';
import { HrApprovalInboxService } from './hr-approval-inbox.service';
import { HrApprovalNotificationService } from './hr-approval-notification.service';

@Controller('api/hr/approvals')
export class HrApprovalInboxController {
  private readonly logger = new Logger(HrApprovalInboxController.name);

  constructor(private readonly inbox: HrApprovalInboxService,
    private readonly onboarding: HrOnboardingService, private readonly offboarding: HrOffboardingService,
    private readonly salary: HrSalaryService, private readonly monthly: HrMonthlyReviewService,
    private readonly bank: HrBankChangeService, private readonly corrections: HrTimeCorrectionService,
    private readonly transfers: HrTransferService,
    private readonly notifications: HrApprovalNotificationService) {}

  @Get() async list(@Req() request: RequestWithUser, @Query('storeId') storeId?: string) {
    const startedAt = Date.now();
    const userId = request.user?.id ?? 'unknown';
    const store = storeId || 'all-authorized';
    try {
      const result = await this.inbox.list(request.user, storeId);
      this.logger.log(`approval-inbox userId=${userId} storeId=${store} status=200 records=${result.length} durationMs=${Date.now() - startedAt}`);
      return result;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`approval-inbox userId=${userId} storeId=${store} status=${status} errorType=${errorType} durationMs=${Date.now() - startedAt}`);
      throw error;
    }
  }

  @Post('notifications/retry') retryNotification(@Req() request: RequestWithUser) {
    if (!request.user?.id) throw new BadRequestException('User is required');
    return this.notifications.retryOneForUser(request.user.id);
  }

  @Post(':kind/:id/decisions') decide(@Req() request: RequestWithUser,
    @Param('kind') kind: string, @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>) {
    switch (kind) {
      case 'ONBOARDING': return this.onboarding.decide(request.user, id, body);
      case 'OFFBOARDING': return this.offboarding.decide(request.user, id, body);
      case 'SALARY_CHANGE': return this.salary.decide(request.user, id, body);
      case 'MONTHLY_REVIEW': return this.monthly.decide(request.user, id, body);
      case 'BANK_CHANGE': return this.bank.decide(request.user, id, body);
      case 'TIME_CORRECTION': return this.corrections.decide(request.user, id, body);
      case 'TRANSFER': return this.transfers.decide(request.user, id, body);
      default: throw new BadRequestException('Unknown approval kind');
    }
  }
}
