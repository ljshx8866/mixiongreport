import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.REPORT_SOURCE === 'database' && (!process.env.API_KEY || !process.env.JWT_SECRET))
    throw new Error('API_KEY and JWT_SECRET are required in database mode');
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
