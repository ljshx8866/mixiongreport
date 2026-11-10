import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { DailyReportService } from './report.service';
import { ReportController } from './report.controller';
import { MasterDataController } from './master-data.controller';
import { DailyInputController } from './daily-input.controller';
import { SyncController, SyncService } from './sync.service';
import { AdministrationController } from './administration.controller';
import { HealthController } from './health.controller';
import { AuthController } from './auth.controller';
import { ExportController } from './export.controller';
import { AuthService, JwtAccessGuard } from './auth';
import { ReminderController, ReminderService } from './reminder.service';
import { HrAccessService } from './hr/hr-access.service';
import { HrCurrentAccessController } from './hr/hr-current-access.controller';
import { HrRoleAdminController } from './hr/hr-role-admin.controller';
import { HrTransferController } from './hr/hr-transfer.controller';
import { HrTransferService } from './hr/hr-transfer.service';
import { HrApprovalService } from './hr/hr-approval.service';
import { HrApprovalInboxService } from './hr/hr-approval-inbox.service';
import { HrApprovalInboxController } from './hr/hr-approval-inbox.controller';
import { HrApprovalNotificationService } from './hr/hr-approval-notification.service';
import { HrEmployeeController } from './hr/hr-employee.controller';
import { HrEmployeeExportService } from './hr/hr-employee-export.service';
import { HrScheduleController } from './hr/hr-schedule.controller';
import { HrScheduleService } from './hr/hr-schedule.service';
import { HrScheduleNotificationService } from './hr/hr-schedule-notification.service';
import { HrTimeController } from './hr/hr-time.controller';
import { HrTimeService } from './hr/hr-time.service';
import { HrTimeCorrectionController } from './hr/hr-time-correction.controller';
import { HrTimeCorrectionService } from './hr/hr-time-correction.service';
import { HrMonthlyReviewController } from './hr/hr-monthly-review.controller';
import { HrMonthlyReviewService } from './hr/hr-monthly-review.service';
import { HrMonthlyExportService } from './hr/hr-monthly-export.service';
import { HrSensitiveDraftController } from './hr/hr-sensitive-draft.controller';
import { HrSensitiveDraftService } from './hr/hr-sensitive-draft.service';
import { HrOcrPreviewController } from './hr/hr-ocr-preview.controller';
import { HrOcrPreviewService } from './hr/hr-ocr-preview.service';
import { HrOcrUploadGuard } from './hr/hr-ocr-upload.guard';
import { HrOcrCredentialsController } from './hr/hr-ocr-credentials.controller';
import { HrOcrCredentialsService } from './hr/hr-ocr-credentials.service';
import { HrOnboardingController } from './hr/hr-onboarding.controller';
import { HrOnboardingService } from './hr/hr-onboarding.service';
import { HrJobPositionController } from './hr/hr-job-position.controller';
import { HrJobPositionService } from './hr/hr-job-position.service';
import { HrOffboardingController } from './hr/hr-offboarding.controller';
import { HrOffboardingService } from './hr/hr-offboarding.service';
import { HrSalaryController } from './hr/hr-salary.controller';
import { HrSalaryService } from './hr/hr-salary.service';
import { HrBankChangeController } from './hr/hr-bank-change.controller';
import { HrBankChangeService } from './hr/hr-bank-change.service';
import { MiniappDecorationController } from './miniapp-decoration.controller';
import { UserNotificationsController } from './user-notifications.controller';
import { SystemAlertController } from './system-alert.controller';
import { SystemAlertService } from './system-alert.service';
import { SystemAlertExceptionFilter } from './system-alert-exception.filter';
import { PasswordPolicyController } from './password-policy.controller';
import { PasswordPolicyService } from './password-policy.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET || 'development-only-secret', signOptions: { expiresIn: '12h' } }),
  ],
  controllers: [HealthController, AuthController, ReportController, MasterDataController, DailyInputController, SyncController, AdministrationController, PasswordPolicyController, ExportController, ReminderController, HrRoleAdminController, HrCurrentAccessController, HrTransferController, HrApprovalInboxController, HrEmployeeController, HrSensitiveDraftController, HrOcrPreviewController, HrOcrCredentialsController, HrOnboardingController, HrJobPositionController, HrOffboardingController, HrSalaryController, HrScheduleController, HrTimeController, HrTimeCorrectionController, HrMonthlyReviewController, HrBankChangeController, MiniappDecorationController, UserNotificationsController, SystemAlertController],
  providers: [PrismaService, DailyReportService, SyncService, AuthService, PasswordPolicyService, ReminderService, HrAccessService, HrApprovalNotificationService, HrTransferService, HrApprovalService, HrApprovalInboxService, HrScheduleService, HrScheduleNotificationService, HrTimeService, HrTimeCorrectionService, HrSensitiveDraftService, HrOcrPreviewService, HrOcrUploadGuard, HrOcrCredentialsService, HrOnboardingService, HrJobPositionService, HrOffboardingService, HrSalaryService, HrMonthlyReviewService, HrMonthlyExportService, HrEmployeeExportService, HrBankChangeService, SystemAlertService, { provide: APP_FILTER, useClass: SystemAlertExceptionFilter }, { provide: APP_GUARD, useClass: JwtAccessGuard }],
})
export class AppModule {}
