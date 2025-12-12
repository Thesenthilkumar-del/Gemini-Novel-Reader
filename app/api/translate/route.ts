import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const systemInstruction = "You are a professional translator. Detect proper names (e.g., 'Jiang Chen') and keep them capitalized. Do not translate names literally.";

    // Primary: Use Gemini 2.5 Pro (December 2025 stable model)
    let model;
    let useFallback = false;

    try {
      model = genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        systemInstruction
      });
    } catch (error: any) {
      console.log('gemini-2.5-pro not available, using gemini-2.5-flash');
      useFallback = true;
      model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction
      });
    }

    try {
      const result = await model.generateContent(text);
      
      // Validate response structure before accessing text()
      if (!result || !result.response) {
        console.error('Invalid API response structure:', {
          hasResult: !!result,
          hasResponse: !!(result?.response),
        });
        return NextResponse.json(
          { error: 'Translation API returned invalid response structure' },
          { status: 500 }
        );
      }

      // Extract translation with validation
      let translation: string | undefined;
      try {
        translation = result.response.text();
      } catch (textError: any) {
        console.error('Failed to extract text from response:', textError);
        return NextResponse.json(
          { error: 'Failed to extract translation from API response' },
          { status: 500 }
        );
      }

      // Validate that translation exists and is a non-empty string
      if (!translation || typeof translation !== 'string' || translation.trim().length === 0) {
        console.error('Invalid translation value:', {
          translation,
          type: typeof translation,
          hasResponse: !!result.response,
        });
        return NextResponse.json(
          { error: 'Translation API returned empty or invalid response' },
          { status: 500 }
        );
      }

      return NextResponse.json({ translation });
    } catch (error: any) {
      // If primary model fails and we haven't tried fallback, try fallback
      if (!useFallback && (error?.message?.includes('404') || error?.message?.includes('not found') || error?.status === 404)) {
        console.log('gemini-2.5-pro failed, trying gemini-2.5-flash');
        model = genAI.getGenerativeModel({
          model: 'gemini-2.5-flash',
          systemInstruction
        });
        const result = await model.generateContent(text);
        
        // Validate response structure before accessing text()
        if (!result || !result.response) {
          console.error('Invalid fallback API response structure:', {
            hasResult: !!result,
            hasResponse: !!(result?.response),
          });
          return NextResponse.json(
            { error: 'Translation API (fallback) returned invalid response structure' },
            { status: 500 }
          );
        }

        // Extract translation with validation
        let translation: string | undefined;
        try {
          translation = result.response.text();
        } catch (textError: any) {
          console.error('Failed to extract text from fallback response:', textError);
          return NextResponse.json(
            { error: 'Failed to extract translation from fallback API response' },
            { status: 500 }
          );
        }
        
        if (!translation || typeof translation !== 'string' || translation.trim().length === 0) {
          console.error('Invalid translation value from fallback:', {
            translation,
            type: typeof translation,
            hasResponse: !!result.response,
          });
          return NextResponse.json(
            { error: 'Translation API (fallback) returned empty or invalid response' },
            { status: 500 }
          );
        }
        return NextResponse.json({ translation });
      }
      throw error;
    }

  } catch (error: any) {
    console.error('Translation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}