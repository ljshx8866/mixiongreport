import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrMonthlyReviewService } from './hr-monthly-review.service';
import { HrMonthlyExportService } from './hr-monthly-export.service';

@Controller('api/hr/monthly-reviews')
export class HrMonthlyReviewController {
  constructor(private readonly reviews: HrMonthlyReviewService,
    private readonly exports: HrMonthlyExportService) {}

  @Get('preview') preview(@Req() request: RequestWithUser,
    @Query('storeId') storeId: string, @Query('month') month: string) {
    return this.reviews.preview(request.user, storeId, month);
  }

  @Get() list(@Req() request: RequestWithUser,
    @Query('storeId') storeId: string, @Query('month') month: string) {
    return this.reviews.list(request.user, storeId, month);
  }

  @Post() submit(@Req() request: RequestWithUser,
    @Body() body: Record<string, unknown>) {
    return this.reviews.submit(request.user, body.storeId, body.month);
  }

  @Post(':id/decisions') decide(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.reviews.decide(request.user, id, body);
  }

  @Get(':id/export.xlsx') async exportExcel(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Res() response: any) {
    const file = await this.exports.generate(request.user, BigInt(id));
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.buffer);
  }
}
