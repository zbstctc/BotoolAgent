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
import { AdversarialReviewStep, type ReviewStepResult } from '@/components/pipeline/AdversarialReviewStep';
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
  const [fixedPrdContent, setFixedPrdContent] = useState<string>('');
  const [ruleAuditSummary, setRuleAuditSummary] = useState<string>('');
  const [enrichResult, setEnrichResult] = useState<AutoEnrichResult | null>(null);
  const [fixedEnrichResult, setFixedEnrichResult] = useState<AutoEnrichResult | null>(null);

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
  // Step 0: Rule selection complete
  const handleRuleCheckComplete = useCallback((rules: RuleDocument[]) => {
    setSelectedRules(rules);
    setCurrentStep(1);
  }, []);

  // Step 1: PRD adversarial review complete
  const handlePrdReviewComplete = useCallback((result: ReviewStepResult) => {
    setFixedPrdContent(result.fixedContent);
    setRuleAuditSummary(result.ruleAuditSummary || '');
    setCurrentStep(2);
  }, []);

  // Step 2: Auto enrich complete
  const handleAutoEnrichComplete = useCallback((result: AutoEnrichResult) => {
    setEnrichResult(result);
    setCurrentStep(3);
  }, []);

  // Step 3: Enrich adversarial review complete
  const handleEnrichReviewComplete = useCallback((result: ReviewStepResult) => {
    // Try to parse the fixed enrich content back to AutoEnrichResult
    if (result.fixedContent) {
      try {
        const parsed = JSON.parse(result.fixedContent) as AutoEnrichResult;
        setFixedEnrichResult(parsed);
      } catch {
        // If parsing fails, keep original enrichResult
      }
    }
    setCurrentStep(4);
  }, []);

  // Step 4: Enrichment summary complete → navigate to Stage 3
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

  // Derived values
  const effectivePrdContent = fixedPrdContent || prdContent;
  const selectedRuleIds = selectedRules.map(r => r.id);
  const effectiveEnrichResult = fixedEnrichResult || enrichResult;

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
          <AdversarialReviewStep
            reviewTarget="prd"
            content={prdContent}
            selectedRuleIds={selectedRuleIds}
            projectId={activeProject?.id}
            onComplete={handlePrdReviewComplete}
            onBack={handleBack}
          />
        );
      case 2:
        return (
          <AutoEnrichStep
            prdContent={effectivePrdContent}
            mode={mode}
            onComplete={handleAutoEnrichComplete}
            onBack={handleBack}
          />
        );
      case 3:
        return (
          <AdversarialReviewStep
            reviewTarget="enrich"
            content={enrichResult ? JSON.stringify(enrichResult) : ''}
            projectId={activeProject?.id}
            onComplete={handleEnrichReviewComplete}
            onBack={handleBack}
          />
        );
      case 4:
        return (
          <EnrichmentSummary
            prdContent={effectivePrdContent}
            projectName={activeProject?.name || 'New Project'}
            projectId={activeProject?.id}
            sourcePrdId={sourcePrdId}
            mode={mode}
            selectedRules={selectedRules}
            enrichResult={effectiveEnrichResult}
            ruleAuditSummary={ruleAuditSummary}
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
        stageStatus={`步骤 ${currentStep + 1}/5`}
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
