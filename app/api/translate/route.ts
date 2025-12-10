import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

const PROMPT = 'You are a professional novelist translator. Translate the following markdown content into English, preserving the narrative flow, tone, and formatting.';

const CHUNK_SIZE = 8000;
const MAX_LENGTH = 10000;

function chunkText(text: string): string[] {
  if (text.length <= MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let currentChunk = '';
  
  // Split by paragraphs first to maintain readability
  const paragraphs = text.split(/\n\n+/);
  
  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > CHUNK_SIZE && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

export async function POST(request: NextRequest) {
  try {
    const { content } = await request.json();

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Try gemini-2.5-flash first, fallback to gemini-pro if it fails
    let model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    let useFallback = false;
    
    const chunks = chunkText(content);
    const translatedChunks: string[] = [];

    // Translate chunks sequentially
    for (const chunk of chunks) {
      const fullPrompt = `${PROMPT}\n\n${chunk}`;
      
      try {
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const translated = response.text();
        
        translatedChunks.push(translated);
      } catch (error: any) {
        // If model not found error and we haven't fallen back yet, try fallback model
        if (!useFallback && (error?.message?.includes('not found') || error?.status === 404 || error?.message?.includes('404'))) {
          console.log('gemini-2.5-flash not found, falling back to gemini-pro');
          model = genAI.getGenerativeModel({ model: 'gemini-pro' });
          useFallback = true;
          
          // Retry with fallback model
          const result = await model.generateContent(fullPrompt);
          const response = await result.response;
          const translated = response.text();
          
          translatedChunks.push(translated);
        } else {
          throw error;
        }
      }
    }

    const translated = translatedChunks.join('\n\n');

    return NextResponse.json({ translated });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Translation failed' },
      { status: 500 }
    );
  }
}

