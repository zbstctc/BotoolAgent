/**
 * @deprecated This API is no longer used.
 * Stage 1 now uses CLI chat mode with /botoolagent-pyramidprd skill.
 * This file is kept for reference only.
 */

import { NextRequest } from 'next/server';
import { parseSkillPrompts, fillPromptTemplate } from '@/lib/skill-parser';

interface IterateRequest {
  currentPrd: string;
  modificationRequest: string;
  collectedAnswers: Record<string, string | string[]>;
}

export async function POST(request: NextRequest) {
  try {
    const body: IterateRequest = await request.json();
    const { currentPrd, modificationRequest, collectedAnswers } = body;

    if (!modificationRequest) {
      return new Response(JSON.stringify({ error: 'Modification request is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get prompts from skill
    const prompts = await parseSkillPrompts();
    const template = prompts.ITERATION_ANALYSIS_PROMPT;

    if (!template) {
      // Return default analysis
      return new Response(JSON.stringify(getDefaultAnalysis(modificationRequest)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fill template
    const filledPrompt = fillPromptTemplate(template, {
      currentPrd,
      modificationRequest,
      collectedAnswers: JSON.stringify(collectedAnswers),
    });

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify(getDefaultAnalysis(modificationRequest)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: filledPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify(getDefaultAnalysis(modificationRequest)), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const textBlock = data.content?.find((block: { type: string }) => block.type === 'text');
    const responseText = textBlock?.text || '';

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return new Response(JSON.stringify({
        affectedLevels: parsed.affectedLevels || [2, 3],
        unchangedLevels: parsed.unchangedLevels || [1, 4],
        analysis: parsed.analysis || '已分析修改请求',
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(getDefaultAnalysis(modificationRequest)), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Iteration analysis error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function getDefaultAnalysis(modificationRequest: string) {
  // Simple keyword-based analysis
  const request = modificationRequest.toLowerCase();

  const affectedLevels: number[] = [];
  const unchangedLevels: number[] = [];

  // L1 keywords (user, problem, goal)
  if (request.includes('用户') || request.includes('目标') || request.includes('问题')) {
    affectedLevels.push(1);
  } else {
    unchangedLevels.push(1);
  }

  // L2 keywords (frontend, backend, architecture)
  if (request.includes('界面') || request.includes('后端') || request.includes('数据') || request.includes('功能')) {
    affectedLevels.push(2);
  } else {
    unchangedLevels.push(2);
  }

  // L3 keywords (details, implementation)
  if (request.includes('细节') || request.includes('实现') || request.includes('流程') || request.includes('交互')) {
    affectedLevels.push(3);
  } else {
    unchangedLevels.push(3);
  }

  // L4 keywords (scope, criteria)
  if (request.includes('范围') || request.includes('验收') || request.includes('不包含')) {
    affectedLevels.push(4);
  } else {
    unchangedLevels.push(4);
  }

  // Default: affect L2 and L3 if nothing detected
  if (affectedLevels.length === 0) {
    return {
      affectedLevels: [2, 3],
      unchangedLevels: [1, 4],
      analysis: '根据修改请求，可能需要重新确认功能领域和实现细节。',
    };
  }

  return {
    affectedLevels,
    unchangedLevels,
    analysis: `根据修改请求，需要重新确认 L${affectedLevels.join('、L')} 层级的问题。`,
  };
}
