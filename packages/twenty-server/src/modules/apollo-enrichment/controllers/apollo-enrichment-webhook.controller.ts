import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { type ApolloPhoneEnrichmentWebhookPayload } from 'src/modules/apollo-enrichment/types/apollo-api.type';

@Controller('webhooks/apollo')
export class ApolloEnrichmentWebhookController {
  constructor(
    private readonly apolloEnrichmentService: ApolloEnrichmentService,
  ) {}

  @Post('enrichment/:token')
  @HttpCode(204)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async receiveEnrichmentResult(
    @Param('token') token: string,
    @Body() payload: ApolloPhoneEnrichmentWebhookPayload,
  ): Promise<void> {
    await this.apolloEnrichmentService.handlePhoneEnrichmentWebhook({
      token,
      payload,
    });
  }
}
