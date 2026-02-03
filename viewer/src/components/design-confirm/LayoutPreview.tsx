'use client';

export interface LayoutArea {
  id: string;
  name: string;
  position: 'header' | 'sidebar' | 'main' | 'footer';
  components: string[];
}

export interface LayoutData {
  title: string;
  areas: LayoutArea[];
  description?: string;
}

interface LayoutPreviewProps {
  layoutData: LayoutData;
}

export function LayoutPreview({ layoutData }: LayoutPreviewProps) {
  const { title, areas, description } = layoutData;

  // Group areas by position
  const header = areas.find(a => a.position === 'header');
  const sidebar = areas.find(a => a.position === 'sidebar');
  const main = areas.find(a => a.position === 'main');
  const footer = areas.find(a => a.position === 'footer');

  return (
    <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
      {/* Title */}
      <div className="p-4 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {description && (
          <p className="text-xs text-neutral-500 mt-1">{description}</p>
        )}
      </div>

      {/* Layout Preview */}
      <div className="p-4">
        <div className="border-2 border-dashed border-neutral-300 rounded-lg overflow-hidden bg-neutral-50">
          {/* Header */}
          {header && (
            <LayoutAreaBlock
              area={header}
              className="border-b-2 border-dashed border-neutral-300"
            />
          )}

          {/* Middle Row */}
          <div className="flex">
            {/* Sidebar */}
            {sidebar && (
              <LayoutAreaBlock
                area={sidebar}
                className="w-48 border-r-2 border-dashed border-neutral-300"
              />
            )}

            {/* Main */}
            {main && (
              <LayoutAreaBlock
                area={main}
                className="flex-1 min-h-40"
              />
            )}
          </div>

          {/* Footer */}
          {footer && (
            <LayoutAreaBlock
              area={footer}
              className="border-t-2 border-dashed border-neutral-300"
            />
          )}
        </div>
      </div>

      {/* Component List */}
      <div className="p-4 border-t border-neutral-200 bg-neutral-50">
        <h4 className="text-xs font-medium text-neutral-700 mb-2">
          组件列表
        </h4>
        <div className="flex flex-wrap gap-2">
          {areas.flatMap(area => area.components).map((component, index) => (
            <span
              key={index}
              className="px-2 py-1 text-xs bg-white border border-neutral-200 rounded"
            >
              {component}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LayoutAreaBlock({
  area,
  className,
}: {
  area: LayoutArea;
  className?: string;
}) {
  return (
    <div className={`p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-neutral-600">
          {area.name}
        </span>
        <span className="text-[10px] text-neutral-400 uppercase">
          {area.position}
        </span>
      </div>
      {area.components.length > 0 && (
        <div className="space-y-1">
          {area.components.map((component, index) => (
            <div
              key={index}
              className="h-6 bg-white border border-neutral-200 rounded px-2 flex items-center"
            >
              <span className="text-[10px] text-neutral-500 truncate">
                {component}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
