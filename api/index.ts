import { createApp } from '../server/app';

/**
 * Vercel serverless entry. The same Express app runs locally and in production,
 * so there is no second code path for the API to drift into.
 */
export default createApp();
