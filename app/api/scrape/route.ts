import { NextRequest } from 'next/server';
import { scraper } from '../../lib/scraper';

interface ScrapeRequest {
  novelUrl: string;
  chapterUrl: string;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ScrapeRequest = await request.json();

    if (!body.novelUrl || !body.chapterUrl) {
      return new Response(
        JSON.stringify({
          error: 'Missing required parameters',
          message: 'Both novelUrl and chapterUrl are required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!isValidUrl(body.chapterUrl)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid URL',
          message: 'chapterUrl must be a valid URL with http:// or https:// protocol',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Scraping chapter from ${body.chapterUrl}`);

    const startTime = Date.now();
    const result = await scraper.scrape(body.chapterUrl);
    const endTime = Date.now();
    const duration = endTime - startTime;

    const response = {
      ...result,
      timing: {
        duration,
        timestamp: new Date().toISOString(),
      },
      metadata: {
        novelUrl: body.novelUrl,
        chapterUrl: body.chapterUrl,
      },
    };

    if (result.error) {
      return new Response(JSON.stringify(response), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (duration > 10000) {
      console.warn(`Scraping took ${duration}ms, exceeding target of 10000ms`);
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const stack = (error as Error).stack;

    console.error('Scraping error:', errorMessage, stack);

    return new Response(
      JSON.stringify({
        error: 'Scraping failed',
        message: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? stack : undefined,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}