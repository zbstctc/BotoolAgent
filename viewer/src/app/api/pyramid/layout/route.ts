/**
 * @deprecated This API is no longer used.
 * Stage 1 now uses CLI chat mode with /botoolagent-pyramidprd skill.
 * This file is kept for reference only.
 */

import { NextRequest } from 'next/server';
import { parseSkillPrompts, fillPromptTemplate } from '@/lib/skill-parser';

interface LayoutRequest {
  prdContent: string;
  collectedAnswers: Record<string, string | string[]>;
}

export async function POST(request: NextRequest) {
  try {
    const body: LayoutRequest = await request.json();
    const { prdContent, collectedAnswers } = body;

    if (!prdContent) {
      return new Response(JSON.stringify({ error: 'PRD content is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get prompts from skill
    const prompts = await parseSkillPrompts();
    const template = prompts.LAYOUT_GENERATION_PROMPT;

    if (!template) {
      // Return mock layout
      return new Response(JSON.stringify({
        layout: getMockLayout(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fill template
    const filledPrompt = fillPromptTemplate(template, {
      prdContent,
      collectedAnswers: JSON.stringify(collectedAnswers),
    });

    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        layout: getMockLayout(),
      }), {
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
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: filledPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({
        layout: getMockLayout(),
      }), {
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
        layout: parsed,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      layout: getMockLayout(),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Layout generation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function getMockLayout() {
  return {
    title: '页面布局预览',
    description: '根据 PRD 生成的页面布局结构',
    areas: [
      {
        id: 'header',
        name: '顶部导航',
        position: 'header',
        components: ['Logo', '导航菜单', '用户头像'],
      },
      {
        id: 'sidebar',
        name: '侧边栏',
        position: 'sidebar',
        components: ['功能菜单', '快捷操作'],
      },
      {
        id: 'main',
        name: '主内容区',
        position: 'main',
        components: ['内容列表', '操作按钮', '详情面板'],
      },
      {
        id: 'footer',
        name: '底部',
        position: 'footer',
        components: ['版权信息', '链接'],
      },
    ],
  };
}
