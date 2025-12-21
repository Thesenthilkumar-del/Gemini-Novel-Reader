
export async function translateWithGoogle(text: string, apiKey: string): Promise<string> {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        target: 'en',
        format: 'text',
      }),
    });

    if (!response.ok) {
        // If 403 or 400, might be key issue.
        const errorBody = await response.text();
        throw new Error(`Google Translate API failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    
    if (data.data && data.data.translations && data.data.translations.length > 0) {
      // Google Translate might decode HTML entities which we might want to avoid if input was markdown
      // But since we sent format: 'text', it should be fine.
      return data.data.translations[0].translatedText;
    }
    
    throw new Error('Invalid response from Google Translate API');
  } catch (error) {
    console.error('Google Translate Error:', error);
    throw error;
  }
}
