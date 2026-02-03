import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description } = body;

    if (!description || typeof description !== 'string') {
      return new Response(JSON.stringify({ error: 'Description is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Fallback to smart extraction if no API key
      const title = extractTitle(description);
      return new Response(JSON.stringify({ title }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call Anthropic API directly
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: `根据以下需求描述，生成一个简短的项目标题（10-20个中文字符）。只输出标题本身，不要引号、标点或其他内容。\n\n需求描述：${description}`,
          },
        ],
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const textBlock = data.content?.find((block: { type: string }) => block.type === 'text');
      const title = textBlock?.text?.trim().slice(0, 30) || extractTitle(description);
      return new Response(JSON.stringify({ title }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fallback on API error
    return new Response(JSON.stringify({ title: extractTitle(description) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Generate title error:', error);
    // Fallback on error
    return new Response(JSON.stringify({ title: '' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Smart title extraction from description
function extractTitle(description: string): string {
  // Remove common filler words and extract key phrases
  const trimmed = description.trim();

  // Try to find a sentence boundary within first 30 chars
  const firstSentence = trimmed.split(/[，。！？,!?]/)[0];
  if (firstSentence.length >= 5 && firstSentence.length <= 25) {
    return firstSentence;
  }

  // Otherwise just truncate
  if (trimmed.length <= 25) {
    return trimmed;
  }
  return trimmed.slice(0, 22) + '...';
}
