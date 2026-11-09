import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrTimeCorrectionService } from './hr-time-correction.service';

@Controller('api/hr/time-corrections')
export class HrTimeCorrectionController {
  constructor(private readonly corrections: HrTimeCorrectionService) {}

  @Get() list(@Req() request: RequestWithUser, @Query('storeId') storeId: string) {
    return this.corrections.list(request.user, storeId);
  }

  @Post() request(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.corrections.request(request.user, body);
  }

  @Post(':id/decisions') decide(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.corrections.decide(request.user, id, body);
  }
}
