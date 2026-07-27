import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

@Controller('webhooks/apollo')
export class ApolloEnrichmentWebhookController {
  @Post('enrichment')
  @HttpCode(204)
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  receiveEnrichmentResult(): void {
    // Results are read through Apollo's polling endpoint so workers can
    // correlate each response without trusting data from a public callback.
  }
}
