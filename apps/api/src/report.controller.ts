import { BadRequestException, Controller, Get, ParseIntPipe, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DailyReportService, toDate } from './report.service';
import { assertStoreAccess, type RequestWithUser } from './auth';
import { HrAccessService } from './hr/hr-access.service';

const shanghaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

@Controller('api/reports')
export class ReportController {
  constructor(private readonly reports: DailyReportService, private readonly access: HrAccessService) {}
  private validateDailyReportQuery(storeId: number, date: string) {
    if (!Number.isSafeInteger(storeId) || storeId <= 0) throw new BadRequestException('Invalid storeId');
    try { toDate(date); } catch { throw new BadRequestException('Invalid date; expected YYYY-MM-DD'); }
  }

  private async assertReportAccess(request: RequestWithUser, storeId: number, date: string) {
    if (process.env.REPORT_SOURCE !== 'database' || request.user?.system || request.user?.role === UserRole.ADMIN) {
      assertStoreAccess(request.user, storeId);
      return;
    }
    await this.access.assertStorePermission(request.user,
      date < shanghaiToday() ? 'HR_HISTORY_REPORT_READ' : 'HR_DAILY_REPORT_READ', BigInt(storeId));
  }

  @Get('daily')
  async daily(@Req() request: RequestWithUser, @Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    this.validateDailyReportQuery(storeId, date);
    await this.assertReportAccess(request, storeId, date);
    return this.reports.getDailyReport(storeId, date);
  }

  @Get('home-sales')
  async homeSales(@Req() request: RequestWithUser, @Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    this.validateDailyReportQuery(storeId, date);
    if (process.env.REPORT_SOURCE !== 'database' || request.user?.system || request.user?.role === UserRole.ADMIN)
      assertStoreAccess(request.user, storeId);
    else await this.access.assertStorePermission(request.user, 'HR_HOME_SALES_READ', BigInt(storeId));
    const report: any = await this.reports.getDailyReport(storeId, date);
    // The home-card permission exposes only its own metrics, not the full report.
    return {
      store: report.store,
      sales: { total: report.sales?.total ?? null },
      status: { manualInputReady: report.status?.manualInputReady ?? false },
    };
  }

  @Get('daily/poster')
  async dailyPoster(@Req() request: RequestWithUser, @Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    this.validateDailyReportQuery(storeId, date);
    await this.assertReportAccess(request, storeId, date);
    if (process.env.REPORT_SOURCE === 'database' && !request.user?.system && request.user?.role !== UserRole.ADMIN)
      await this.access.assertStorePermission(request.user, 'HR_DAILY_REPORT_POSTER', BigInt(storeId));
    return this.reports.getDailyReport(storeId, date);
  }
}
