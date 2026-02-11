'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StageIndicator } from '@/components';
import { useProject } from '@/contexts/ProjectContext';
import { PipelineProgress, DEFAULT_STEPS } from '@/components/pipeline/PipelineProgress';
import { RuleCheckStep, type RuleDocument } from '@/components/pipeline/RuleCheckStep';
import { AutoEnrichStep, type AutoEnrichResult } from '@/components/pipeline/AutoEnrichStep';
import { EnrichmentSummary } from '@/components/pipeline/EnrichmentSummary';
import type { EnrichedPrdJson, PipelineMode } from '@/lib/tool-types';

export default function Stage2Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeProject, updateProject } = useProject();

  // Pipeline mode from query param
  const mode = (searchParams.get('mode') as PipelineMode) || 'feature';

  // Pipeline state
  const [currentStep, setCurrentStep] = useState(0);
  const [prdContent, setPrdContent] = useState('');

  // Step results
  const [selectedRules, setSelectedRules] = useState<RuleDocument[]>([]);
  const [enrichResult, setEnrichResult] = useState<AutoEnrichResult | null>(null);

  // Load PRD content from URL param or session storage
  useEffect(() => {
    // First try sessionStorage
    const storedPrd = sessionStorage.getItem('botool-stage2-prd');
    if (storedPrd) {
      setPrdContent(storedPrd);
      return;
    }

    // Then try loading from API using URL param
    const prdId = searchParams.get('prd');
    if (prdId) {
      fetch(`/api/prd/${encodeURIComponent(prdId)}`)
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
  }, [searchParams]);

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
    // Update project with branch name
    if (activeProject && prdJson.branchName) {
      updateProject(activeProject.id, {
        branchName: prdJson.branchName,
        currentStage: 3,
      });
    }

    // Navigate to Stage 3
    router.push('/stage3');
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
