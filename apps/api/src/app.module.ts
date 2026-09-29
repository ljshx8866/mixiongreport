import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET || 'development-only-secret', signOptions: { expiresIn: '12h' } }),
  ],
  controllers: [HealthController, AuthController, ReportController, MasterDataController, DailyInputController, SyncController, AdministrationController, ExportController],
  providers: [PrismaService, DailyReportService, SyncService, AuthService, { provide: APP_GUARD, useClass: JwtAccessGuard }],
})
export class AppModule {}
