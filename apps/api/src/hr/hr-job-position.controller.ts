import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { HrJobPositionService } from './hr-job-position.service';

@Controller('api/hr/job-positions')
export class HrJobPositionController {
  constructor(private readonly service: HrJobPositionService) {}

  @Get('selectable') selectable(@Req() request: RequestWithUser, @Query('storeId') storeId: string) {
    return this.service.selectable(request.user, storeId);
  }

  @Get() list(@Req() request: RequestWithUser, @Query('storeId') storeId?: string) {
    return this.service.listForAdmin(request.user, storeId);
  }

  @Post() create(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.service.create(request.user, body);
  }

  @Patch(':id') update(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>) {
    return this.service.update(request.user, id, body);
  }

  @Delete(':id') remove(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(request.user, id);
  }
}
