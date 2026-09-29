import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UserRole } from '@prisma/client';
import { Roles } from './auth';

function id(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new BadRequestException('Invalid id'); return BigInt(value); }
function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${name} is required`);
  return value.trim();
}
function money(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new BadRequestException('Invalid amount');
  return value;
}

@Controller('api')
@Roles(UserRole.ADMIN)
export class MasterDataController {
  constructor(private readonly db: PrismaService) {}

  @Get('stores') async stores() {
    return (await this.db.store.findMany({ orderBy: { id: 'asc' } })).map((s) => ({
      id: Number(s.id), storeCode: s.storeCode, storeName: s.storeName, brandName: s.brandName,
      externalStoreCode: s.externalStoreCode, regionId: s.regionId && Number(s.regionId), status: s.status,
    }));
  }
  @Post('stores') async createStore(@Body() body: Record<string, unknown>) {
    const s = await this.db.store.create({ data: {
      storeCode: required(body.storeCode, 'storeCode'), storeName: required(body.storeName, 'storeName'),
      brandName: typeof body.brandName === 'string' ? body.brandName : '米熊',
      externalStoreCode: typeof body.externalStoreCode === 'string' ? body.externalStoreCode : null,
      regionId: body.regionId == null ? null : id(Number(body.regionId)),
    } });
    return { id: Number(s.id) };
  }
  @Patch('stores/:id') async updateStore(@Param('id', ParseIntPipe) storeId: number, @Body() body: Record<string, unknown>) {
    const s = await this.db.store.update({ where: { id: id(storeId) }, data: {
      ...(body.storeName !== undefined && { storeName: required(body.storeName, 'storeName') }),
      ...(body.externalStoreCode !== undefined && { externalStoreCode: body.externalStoreCode as string | null }),
      ...(body.status !== undefined && { status: Boolean(body.status) }),
    } });
    return { id: Number(s.id) };
  }
  @Get('categories') async categories() {
    return (await this.db.productCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })).map((c) => ({
      id: Number(c.id), categoryCode: c.categoryCode, categoryName: c.categoryName, brandCode: c.brandCode, sortOrder: c.sortOrder, status: c.status,
    }));
  }
  @Post('categories') async createCategory(@Body() body: Record<string, unknown>) {
    const c = await this.db.productCategory.create({ data: {
      categoryCode: required(body.categoryCode, 'categoryCode'), categoryName: required(body.categoryName, 'categoryName'),
      brandCode: typeof body.brandCode === 'string' ? body.brandCode : null,
      sortOrder: Number(body.sortOrder ?? 0),
    } });
    return { id: Number(c.id) };
  }
  @Patch('categories/:id') async updateCategory(@Param('id', ParseIntPipe) categoryId: number, @Body() body: Record<string, unknown>) {
    const c = await this.db.productCategory.update({ where: { id: id(categoryId) }, data: {
      ...(body.categoryName !== undefined && { categoryName: required(body.categoryName, 'categoryName') }),
      ...(body.sortOrder !== undefined && { sortOrder: Number(body.sortOrder) }),
      ...(body.status !== undefined && { status: Boolean(body.status) }),
    } });
    return { id: Number(c.id) };
  }
  @Get('products') async products() {
    return (await this.db.product.findMany({ orderBy: { id: 'asc' } })).map((p) => ({
      id: Number(p.id), externalProductCode: p.externalProductCode, productName: p.productName,
      categoryId: Number(p.categoryId), salePrice: p.salePrice?.toNumber() ?? null,
      theoreticalCost: p.theoreticalCost?.toNumber() ?? null, status: p.status,
    }));
  }
  @Post('products') async createProduct(@Body() body: Record<string, unknown>) {
    const p = await this.db.product.create({ data: {
      externalProductCode: required(body.externalProductCode, 'externalProductCode'),
      productName: required(body.productName, 'productName'), categoryId: id(Number(body.categoryId)),
      salePrice: money(body.salePrice), theoreticalCost: money(body.theoreticalCost),
    } });
    return { id: Number(p.id) };
  }
  @Patch('products/:id') async updateProduct(@Param('id', ParseIntPipe) productId: number, @Body() body: Record<string, unknown>) {
    if (body.categoryId !== undefined && process.env.POS_ADAPTER === 'wuuxiang')
      throw new BadRequestException('Product category is managed by the POS API');
    const p = await this.db.product.update({ where: { id: id(productId) }, data: {
      ...(body.productName !== undefined && { productName: required(body.productName, 'productName') }),
      ...(body.categoryId !== undefined && { categoryId: id(Number(body.categoryId)) }),
      ...(body.salePrice !== undefined && { salePrice: money(body.salePrice) }),
      ...(body.theoreticalCost !== undefined && { theoreticalCost: money(body.theoreticalCost) }),
      ...(body.status !== undefined && { status: Boolean(body.status) }),
    } });
    return { id: Number(p.id) };
  }
  @Get('period-config') async periods() { return (await this.db.businessPeriod.findMany({ orderBy: { sortOrder: 'asc' } })).map((p) => ({ ...p, id: Number(p.id) })); }
  @Post('period-config') async period(@Body() body: Record<string, unknown>) {
    const code = required(body.periodCode, 'periodCode');
    const startTime = required(body.startTime, 'startTime');
    const endTime = required(body.endTime, 'endTime');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime))
      throw new BadRequestException('Time must be HH:mm');
    const period = await this.db.businessPeriod.upsert({ where: { periodCode: code }, create: {
      periodCode: code, periodName: required(body.periodName, 'periodName'), startTime, endTime, sortOrder: Number(body.sortOrder ?? 0),
      externalShiftId: typeof body.externalShiftId === 'string' ? body.externalShiftId : null,
    }, update: { periodName: required(body.periodName, 'periodName'), startTime, endTime, sortOrder: Number(body.sortOrder ?? 0),
      ...(body.externalShiftId !== undefined && { externalShiftId: body.externalShiftId as string | null }),
    } });
    return { ...period, id: Number(period.id) };
  }
}
