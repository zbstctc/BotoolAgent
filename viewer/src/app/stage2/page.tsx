'use client';

import { Suspense, useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StageIndicator } from '@/components';
import { useProject } from '@/contexts/ProjectContext';
import { useRequirement } from '@/contexts/RequirementContext';
import { PipelineProgress, DEFAULT_STEPS } from '@/components/pipeline/PipelineProgress';
import { RuleCheckStep, type RuleDocument } from '@/components/pipeline/RuleCheckStep';
import { AutoEnrichStep, type AutoEnrichResult } from '@/components/pipeline/AutoEnrichStep';
import { EnrichmentSummary } from '@/components/pipeline/EnrichmentSummary';
import type { EnrichedPrdJson, PipelineMode } from '@/lib/tool-types';

function Stage2PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeProject, updateProject } = useProject();

  // Requirement context - resolve `req` param
  const { requirements } = useRequirement();
  const reqId = searchParams.get('req') || undefined;
  const activeRequirement = reqId ? requirements.find(r => r.id === reqId) : undefined;

  // sourcePrdId: explicit `prd` param takes priority, then req.prdId
  const rawPrdId = searchParams.get('prd') || undefined;
  const sourcePrdId = rawPrdId ?? activeRequirement?.prdId;

  // Pipeline mode from query param
  const mode = (searchParams.get('mode') as PipelineMode) || 'feature';

  // Pipeline state
  const [currentStep, setCurrentStep] = useState(0);
  const [prdContent, setPrdContent] = useState(() => {
    // Lazy initialization: read from sessionStorage synchronously on first render
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('botool-stage2-prd') || '';
    }
    return '';
  });

  // Step results
  const [selectedRules, setSelectedRules] = useState<RuleDocument[]>([]);
  const [enrichResult, setEnrichResult] = useState<AutoEnrichResult | null>(null);

  // Load PRD content from API if not already loaded from sessionStorage
  useEffect(() => {
    if (prdContent) return;

    if (sourcePrdId) {
      fetch(`/api/prd/${encodeURIComponent(sourcePrdId)}`)
        .then(res => {
          if (!res.ok) throw new Error('PRD not found');
          return res.json();
        })
        .then(data => {
          if (data.content) {
            setPrdContent(data.content);
            // Cache in sessionStorage for subsequent steps
            sessionStorage.setItem('botool-stage2-prd', data.content);
          }
        })
        .catch(err => {
          console.error('Failed to load PRD content:', err);
        });
    }
  }, [sourcePrdId, prdContent]);

  // Handle step click (for viewing completed steps)
  const handleStepClick = useCallback((stepIndex: number) => {
    if (stepIndex < currentStep) {
      setCurrentStep(stepIndex);
    }
  }, [currentStep]);

  // Step completion handlers
  const handleRuleCheckComplete = useCallback((rules: RuleDocument[]) => {
    setSelectedRules(rules);
    setCurrentStep(1);
  }, []);

  const handleAutoEnrichComplete = useCallback((result: AutoEnrichResult) => {
    setEnrichResult(result);
    setCurrentStep(2);
  }, []);

  const handleEnrichmentSummaryComplete = useCallback((prdJson: EnrichedPrdJson) => {
    // Update project stage (always advance to 3, branchName is optional metadata)
    if (activeProject) {
      updateProject(activeProject.id, {
        ...(prdJson.branchName ? { branchName: prdJson.branchName } : {}),
        currentStage: 3,
      });
    }

    // Navigate to Stage 3 (carry projectId for multi-project support)
    const params = activeProject?.id ? `?projectId=${activeProject.id}` : '';
    router.push(`/stage3${params}`);
  }, [activeProject, updateProject, router]);

  // Back handlers
  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <RuleCheckStep
            prdContent={prdContent}
            onComplete={handleRuleCheckComplete}
          />
        );
      case 1:
        return (
          <AutoEnrichStep
            prdContent={prdContent}
            mode={mode}
            onComplete={handleAutoEnrichComplete}
            onBack={handleBack}
          />
        );
      case 2:
        return (
          <EnrichmentSummary
            prdContent={prdContent}
            projectName={activeProject?.name || 'New Project'}
            projectId={activeProject?.id}
            sourcePrdId={sourcePrdId}
            mode={mode}
            selectedRules={selectedRules}
            enrichResult={enrichResult}
            onComplete={handleEnrichmentSummaryComplete}
            onBack={handleBack}
          />
        );
      default:
        return null;
    }
  };

  // Calculate step statuses
  const stepsWithStatus = DEFAULT_STEPS.map((step, index) => ({
    ...step,
    status: index < currentStep
      ? 'completed' as const
      : index === currentStep
        ? 'current' as const
        : 'pending' as const,
  }));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Stage Indicator */}
      <StageIndicator
        currentStage={2}
        completedStages={[1]}
        projectName={activeProject?.name}
        stageStatus={`步骤 ${currentStep + 1}/3`}
      />

      {/* Pipeline Progress */}
      <PipelineProgress
        currentStep={currentStep}
        steps={stepsWithStatus}
        onStepClick={handleStepClick}
      />

      {/* Step Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {renderStepContent()}
      </div>
    </div>
  );
}

function Stage2Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Stage2Page() {
  return (
    <Suspense fallback={<Stage2Fallback />}>
      <Stage2PageContent />
    </Suspense>
  );
}
