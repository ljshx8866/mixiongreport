import { BadRequestException, Controller, Param, ParseIntPipe, Post, Req, UploadedFile, UseInterceptors, UseGuards, Body, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { RequestWithUser } from '../auth';
import { HrOcrPreviewService } from './hr-ocr-preview.service';
import { HrOcrUploadGuard } from './hr-ocr-upload.guard';

type Upload = { buffer: Buffer; mimetype: string; size: number };

@Controller('api/hr')
export class HrOcrPreviewController {
  constructor(private readonly service: HrOcrPreviewService) {}

  @Post('employees/:id/ocr-preview')
  @UseGuards(HrOcrUploadGuard)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  preview(@Req() request: RequestWithUser, @Param('id', ParseIntPipe) id: number,
    @Body('documentType') documentType: string, @UploadedFile() file?: Upload) {
    if (!Number.isSafeInteger(id) || id <= 0 || !file?.buffer || !Number.isSafeInteger(file.size))
      throw new BadRequestException('Employee id and ID card image are required');
    return this.service.preview(BigInt(id), request.user,
      { documentType, mimeType: file.mimetype, content: file.buffer });
  }

  @Post('onboarding/ocr-preview')
  @UseGuards(HrOcrUploadGuard)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  previewOnboarding(@Req() request: RequestWithUser, @Query('storeId', ParseIntPipe) storeId: number,
    @Body('documentType') documentType: string, @UploadedFile() file?: Upload) {
    if (!Number.isSafeInteger(storeId) || storeId <= 0 || !file?.buffer || !Number.isSafeInteger(file.size))
      throw new BadRequestException('Store id and ID card image are required');
    return this.service.previewForStore(BigInt(storeId), request.user,
      { documentType, mimeType: file.mimetype, content: file.buffer });
  }
}
