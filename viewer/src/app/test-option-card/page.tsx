'use client';

import { useState } from 'react';
import { OptionCard, Option } from '@/components';

const sampleOptions: Option[] = [
  { id: '1', label: 'Option 1', description: 'This is the first option' },
  { id: '2', label: 'Option 2', description: 'This is the second option' },
  { id: '3', label: 'Option 3', description: 'This is the third option' },
];

export default function TestOptionCardPage() {
  const [singleSelected, setSingleSelected] = useState<string[]>([]);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [otherValue, setOtherValue] = useState('');

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">OptionCard Component Test</h1>

      <section>
        <h2 className="text-lg font-semibold mb-4">Single Select Mode</h2>
        <OptionCard
          options={sampleOptions}
          mode="single"
          selected={singleSelected}
          onChange={setSingleSelected}
          showOther
          otherValue={otherValue}
          onOtherChange={setOtherValue}
        />
        <p className="mt-4 text-sm text-neutral-500">
          Selected: {singleSelected.length > 0 ? singleSelected.join(', ') : 'None'}
          {otherValue && ` (Other: ${otherValue})`}
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">Multi Select Mode</h2>
        <OptionCard
          options={sampleOptions}
          mode="multi"
          selected={multiSelected}
          onChange={setMultiSelected}
        />
        <p className="mt-4 text-sm text-neutral-500">
          Selected: {multiSelected.length > 0 ? multiSelected.join(', ') : 'None'}
        </p>
      </section>
    </div>
  );
}
