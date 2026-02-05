'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { StageIndicator } from '@/components';
import { useProject } from '@/contexts/ProjectContext';
import { PipelineProgress, DEFAULT_STEPS } from '@/components/pipeline/PipelineProgress';
import { RuleCheckStep, type RuleDocument } from '@/components/pipeline/RuleCheckStep';
import { CodeExampleStep, type CodeExample } from '@/components/pipeline/CodeExampleStep';
import { TestCaseStep, type TestCase } from '@/components/pipeline/TestCaseStep';
import { JsonConvertStep } from '@/components/pipeline/JsonConvertStep';

interface PrdJson {
  project: string;
  branchName: string;
  description: string;
  devTasks: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: number;
    passes: boolean;
    notes: string;
  }[];
}

export default function Stage2Page() {
  const router = useRouter();
  const { activeProject, updateProject } = useProject();

  // Pipeline state
  const [currentStep, setCurrentStep] = useState(0);
  const [prdContent, setPrdContent] = useState('');

  // Step results
  const [selectedRules, setSelectedRules] = useState<RuleDocument[]>([]);
  const [codeExamples, setCodeExamples] = useState<CodeExample[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);

  // Load PRD content from session storage
  useState(() => {
    if (typeof window !== 'undefined') {
      const storedPrd = sessionStorage.getItem('botool-stage2-prd');
      if (storedPrd) {
        setPrdContent(storedPrd);
      }
    }
  });

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

  const handleCodeExampleComplete = useCallback((examples: CodeExample[]) => {
    setCodeExamples(examples);
    setCurrentStep(2);
  }, []);

  const handleTestCaseComplete = useCallback((cases: TestCase[]) => {
    setTestCases(cases);
    setCurrentStep(3);
  }, []);

  const handleJsonConvertComplete = useCallback((prdJson: PrdJson) => {
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
          <CodeExampleStep
            prdContent={prdContent}
            onComplete={handleCodeExampleComplete}
            onBack={handleBack}
          />
        );
      case 2:
        return (
          <TestCaseStep
            prdContent={prdContent}
            onComplete={handleTestCaseComplete}
            onBack={handleBack}
          />
        );
      case 3:
        return (
          <JsonConvertStep
            prdContent={prdContent}
            projectName={activeProject?.name || 'New Project'}
            onComplete={handleJsonConvertComplete}
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
        stageStatus={`步骤 ${currentStep + 1}/4`}
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
