import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Post, Put, Req, Res, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { Public, Roles, authUser, type RequestWithUser } from './auth';

const DEFAULT_MODULES = ['input', 'report', 'history', 'reminders'];
const ALLOWED_MODULES = new Set([
  ...DEFAULT_MODULES,
  'my-profile', 'my-schedule', 'my-work', 'schedule', 'hr-input',
  'shift-templates', 'schedule-points', 'time', 'work-statistics', 'employees', 'trials', 'approvals', 'correction', 'transfer', 'onboarding', 'offboarding',
  'salary-change', 'bank-change',
]);
const DEFAULT_SETTINGS = { homeTitle: '米熊 · 经营工作台', homeSubtitle: '常用功能一目了然', defaultHomeModules: DEFAULT_MODULES };
type UploadedImage = { buffer: Buffer; mimetype: string; size: number };
type BinaryResponse = { set(headers: Record<string, string>): void; send(buffer: Buffer): void };

const isImage = (buffer: Buffer, mimeType: string) => {
  if (mimeType === 'image/png') return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/webp') return buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
};

@Controller('api/miniapp')
export class MiniappDecorationController {
  constructor(private readonly db: PrismaService) {}

  private async settings() {
    return this.db.miniappDecoration.upsert({ where: { id: 1 }, create: { id: 1, ...DEFAULT_SETTINGS }, update: {} });
  }

  private dto(row: Awaited<ReturnType<MiniappDecorationController['settings']>>) {
    const modules = Array.isArray(row.defaultHomeModules)
      ? row.defaultHomeModules.filter((id): id is string => typeof id === 'string' && ALLOWED_MODULES.has(id))
      : DEFAULT_MODULES;
    return {
      homeTitle: row.homeTitle,
      homeSubtitle: row.homeSubtitle,
      defaultHomeModules: modules.length ? [...new Set(modules)] : DEFAULT_MODULES,
      bannerUrl: row.homeBannerImage ? `/api/miniapp/decoration/banner?v=${row.updatedAt.getTime()}` : null,
      hasBanner: Boolean(row.homeBannerImage),
      updatedAt: row.updatedAt,
    };
  }

  @Public()
  @Get('decoration')
  async publicDecoration() {
    return this.dto(await this.settings());
  }

  @Get('me/favorites')
  async myFavorites(@Req() request: RequestWithUser) {
    const userId = authUser(request)?.id;
    if (!userId) throw new UnauthorizedException('请先登录后再读取常用功能设置');
    const [user, settings] = await Promise.all([
      this.db.user.findUnique({ where: { id: BigInt(userId) }, select: { homeFavoriteModules: true } }),
      this.settings(),
    ]);
    if (!user) throw new NotFoundException('账号不存在');
    const customized = Array.isArray(user.homeFavoriteModules);
    const source = customized ? user.homeFavoriteModules as unknown[] : this.dto(settings).defaultHomeModules;
    const modules = [...new Set(source.filter((id): id is string => typeof id === 'string' && ALLOWED_MODULES.has(id)))].slice(0, 8);
    return { modules, customized };
  }

  @Put('me/favorites')
  async saveMyFavorites(@Req() request: RequestWithUser, @Body() body: { modules?: unknown }) {
    const userId = authUser(request)?.id;
    if (!userId) throw new UnauthorizedException('请先登录后再保存常用功能设置');
    if (!Array.isArray(body.modules) || body.modules.length > 8 ||
        body.modules.some((id) => typeof id !== 'string' || !ALLOWED_MODULES.has(id)))
      throw new BadRequestException('常用功能设置无效，请重新选择');
    const modules = [...new Set(body.modules as string[])];
    const saved = await this.db.user.update({
      where: { id: BigInt(userId) },
      data: { homeFavoriteModules: modules as Prisma.InputJsonValue },
      select: { homeFavoriteModules: true },
    });
    return { modules: saved.homeFavoriteModules as string[], customized: true };
  }

  @Public()
  @Get('decoration/banner')
  async banner(@Res() response: BinaryResponse) {
    const row = await this.settings();
    if (!row.homeBannerImage || !row.homeBannerMimeType) throw new NotFoundException('Home banner is not configured');
    response.set({ 'Content-Type': row.homeBannerMimeType, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    response.send(Buffer.from(row.homeBannerImage));
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/decoration')
  async adminDecoration() {
    const row = await this.settings();
    return { ...this.dto(row), hasBanner: Boolean(row.homeBannerImage) };
  }

  @Roles(UserRole.ADMIN)
  @Put('admin/decoration')
  async save(@Req() request: RequestWithUser, @Body() body: { homeTitle?: unknown; homeSubtitle?: unknown; defaultHomeModules?: unknown }) {
    if (typeof body.homeTitle !== 'string' || !body.homeTitle.trim() || body.homeTitle.trim().length > 100)
      throw new BadRequestException('首页标题不能为空且不得超过 100 个字符');
    if (typeof body.homeSubtitle !== 'string' || body.homeSubtitle.length > 200)
      throw new BadRequestException('首页说明不得超过 200 个字符');
    if (!Array.isArray(body.defaultHomeModules) || body.defaultHomeModules.length < 1 || body.defaultHomeModules.length > 5 ||
        body.defaultHomeModules.some((item) => typeof item !== 'string' || !ALLOWED_MODULES.has(item)))
      throw new BadRequestException('默认入口最多选择 5 项');
    const defaultHomeModules = [...new Set(body.defaultHomeModules as string[])];
    const before = await this.settings();
    const saved = await this.db.miniappDecoration.upsert({
      where: { id: 1 },
      create: { id: 1, homeTitle: body.homeTitle.trim(), homeSubtitle: body.homeSubtitle.trim(), defaultHomeModules },
      update: { homeTitle: body.homeTitle.trim(), homeSubtitle: body.homeSubtitle.trim(), defaultHomeModules },
    });
    const actorId = authUser(request)?.id;
    await this.db.auditLog.create({ data: {
      userId: actorId == null ? null : BigInt(actorId), entityType: 'MINIAPP_DECORATION', entityId: 1n, action: 'UPDATE',
      beforeData: { homeTitle: before.homeTitle, homeSubtitle: before.homeSubtitle, defaultHomeModules: before.defaultHomeModules },
      afterData: { homeTitle: saved.homeTitle, homeSubtitle: saved.homeSubtitle, defaultHomeModules: saved.defaultHomeModules },
    } });
    return this.dto(saved);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/decoration/banner')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async uploadBanner(@Req() request: RequestWithUser, @UploadedFile() file?: UploadedImage) {
    if (!file?.buffer || !isImage(file.buffer, file.mimetype))
      throw new BadRequestException('请上传有效的 PNG、JPG 或 WebP 图片（最大 5 MB）');
    const before = await this.settings();
    const saved = await this.db.miniappDecoration.update({ where: { id: 1 }, data: { homeBannerImage: file.buffer, homeBannerMimeType: file.mimetype } });
    const actorId = authUser(request)?.id;
    await this.db.auditLog.create({ data: {
      userId: actorId == null ? null : BigInt(actorId), entityType: 'MINIAPP_DECORATION', entityId: 1n, action: 'BANNER_UPLOAD',
      beforeData: { hasBanner: Boolean(before.homeBannerImage), mimeType: before.homeBannerMimeType },
      afterData: { hasBanner: Boolean(saved.homeBannerImage), mimeType: saved.homeBannerMimeType, byteLength: file.size },
    } });
    return this.dto(saved);
  }

  @Roles(UserRole.ADMIN)
  @Delete('admin/decoration/banner')
  async removeBanner(@Req() request: RequestWithUser) {
    const before = await this.settings();
    await this.db.miniappDecoration.update({ where: { id: 1 }, data: { homeBannerImage: null, homeBannerMimeType: null } });
    const actorId = authUser(request)?.id;
    await this.db.auditLog.create({ data: {
      userId: actorId == null ? null : BigInt(actorId), entityType: 'MINIAPP_DECORATION', entityId: 1n, action: 'BANNER_REMOVE',
      beforeData: { hasBanner: Boolean(before.homeBannerImage), mimeType: before.homeBannerMimeType },
      afterData: { hasBanner: false },
    } });
    return { hasBanner: false };
  }
}
