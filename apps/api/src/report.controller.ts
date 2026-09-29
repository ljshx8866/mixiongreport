import { BadRequestException, Controller, Get, ParseIntPipe, Query, Req } from '@nestjs/common';
import { DailyReportService, toDate } from './report.service';
import { assertStoreAccess, type RequestWithUser } from './auth';

@Controller('api/reports')
export class ReportController {
  constructor(private readonly reports: DailyReportService) {}
  @Get('daily')
  daily(@Req() request: RequestWithUser, @Query('storeId', ParseIntPipe) storeId: number, @Query('date') date: string) {
    if (!Number.isSafeInteger(storeId) || storeId <= 0) throw new BadRequestException('Invalid storeId');
    try { toDate(date); } catch { throw new BadRequestException('Invalid date; expected YYYY-MM-DD'); }
    assertStoreAccess(request.user, storeId);
    return this.reports.getDailyReport(storeId, date);
  }
}
