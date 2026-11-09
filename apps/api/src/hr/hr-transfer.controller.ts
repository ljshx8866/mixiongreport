import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { type RequestWithUser } from '../auth';
import { HrTransferService } from './hr-transfer.service';

@Controller('api/hr/transfers')
export class HrTransferController {
  constructor(private readonly transfers: HrTransferService) {}

  @Post() request(@Req() request: RequestWithUser, @Body() body: Record<string, unknown>) {
    return this.transfers.request(request.user, body);
  }

  @Get('destinations') destinations(@Req() request: RequestWithUser,
    @Query('fromStoreId', ParseIntPipe) fromStoreId: number) {
    return this.transfers.destinations(request.user, BigInt(fromStoreId));
  }

  @Get() list(@Req() request: RequestWithUser, @Query('storeId', ParseIntPipe) storeId: number) {
    return this.transfers.list(request.user, BigInt(storeId));
  }

  @Post(':id/decisions') decide(
    @Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) transferId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.transfers.decide(request.user, transferId, body);
  }

  @Post(':id/retry-effect') retryEffect(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) transferId: number) {
    return this.transfers.retryEffect(request.user, transferId);
  }
}
