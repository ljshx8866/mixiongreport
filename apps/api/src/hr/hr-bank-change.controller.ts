import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { RequestWithUser } from '../auth';
import { PrismaService } from '../prisma.service';
import { HrAccessService } from './hr-access.service';
import { HrBankChangeService } from './hr-bank-change.service';

@Controller('api/hr/bank-changes')
export class HrBankChangeController {
  constructor(private readonly service: HrBankChangeService,
    private readonly db: PrismaService, private readonly access: HrAccessService) {}

  @Get() list(@Req() request: RequestWithUser, @Query('storeId') storeId?: string) {
    return this.service.list(request.user, storeId);
  }

  @Get('employees') async employees(@Req() request: RequestWithUser, @Query('storeId') storeIdInput: string) {
    if (!/^\d+$/.test(storeIdInput ?? '') || Number(storeIdInput) <= 0 || !Number.isSafeInteger(Number(storeIdInput)))
      throw new BadRequestException('Invalid store id');
    const storeId = BigInt(storeIdInput);
    await this.access.assertStorePermission(request.user, 'HR_BANK_CHANGE_VERIFY', storeId);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    const date = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
    const employees = await this.db.hrEmployee.findMany({ where: { status: 'ACTIVE', primaryAppointments: { some: {
      storeId, effectiveFrom: { lte: date }, OR: [{ effectiveToExclusive: null }, { effectiveToExclusive: { gt: date } }],
    } } }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' }, take: 200 });
    return employees.map((employee) => ({ id: Number(employee.id), displayName: employee.displayName }));
  }

  @Post('employees/:employeeId/submit') submit(@Req() request: RequestWithUser,
    @Param('employeeId', ParseIntPipe) employeeId: number, @Body() body: Record<string, unknown>) {
    return this.service.submit(request.user, employeeId, body);
  }

  @Post(':id/decisions') decide(@Req() request: RequestWithUser,
    @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.decide(request.user, id, body);
  }
}
