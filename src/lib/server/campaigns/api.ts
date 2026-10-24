import 'server-only';

import type { RequestContext } from '../context';
import { HttpError } from '../http';
import { CampaignError } from './store';

/** Maps a campaign-layer error to the HTTP error the API should answer with. */
export function campaignHttpError(error: unknown): unknown {
  if (error instanceof CampaignError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : error.code === 'conflict' ? 409 : error.code === 'unavailable' ? 503 : 400;
    return new HttpError(status, error.message);
  }
  return error;
}

/** Campaigns queue server-side work, so they exist only in a cloud workspace. */
export function requireCloud(ctx: RequestContext): asserts ctx is Exclude<RequestContext, { mode: 'demo' }> {
  if (ctx.mode !== 'cloud') {
    throw new HttpError(400, 'Campaigns need a cloud workspace with Supabase. Demo mode keeps everything in this browser, so there is nowhere to queue work.');
  }
}

