import {
  Settings as SettingsIcon,
  X,
  RotateCcw,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULTS, type Settings } from "@/hooks/useSettings";
import { THEMES } from "@/lib/themes";

interface SettingsViewProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: (keys?: (keyof Settings)[]) => void;
  onClose: () => void;
  onResetHashes: () => Promise<void>;
  isAnalyzing: boolean;
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title="기본값으로 초기화"
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </button>
  );
}

function SectionHeader({
  children,
  onReset,
}: {
  children: React.ReactNode;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-medium text-foreground select-none">
        {children}
      </h2>
      <ResetButton onClick={onReset} />
    </div>
  );
}

function OptionGroup<T extends number>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "px-3 py-1.5 text-sm rounded-md border transition-colors",
            value === opt
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
          )}
        >
          {label(opt)}
        </button>
      ))}
    </div>
  );
}

const similarityQualityLabel = (value: number): string =>
  (
    ({
      16: "최하",
      15: "낮음",
      14: "하",
      13: "중하",
      12: "중간",
      11: "중상",
      10: "상",
      9: "매우 높음",
      8: "최상",
    }) as Record<number, string>
  )[value] ?? String(value);

const jaccardLabel = (value: number): string => {
  if (value >= 0.68) return "매우 엄격";
  if (value >= 0.64) return "엄격";
  if (value >= 0.58) return "중간";
  if (value >= 0.54) return "느슨";
  return "매우 느슨";
};

const SIMILARITY_MIN = 8;
const SIMILARITY_MAX = 16;
const SIMILARITY_SPAN = SIMILARITY_MAX - SIMILARITY_MIN;
const TEXT_LINK_THRESHOLD_STRICT = 0.64;
const TEXT_LINK_THRESHOLD_LOOSE = 0.54;
const JACCARD_MIN = 0.5;
const JACCARD_MAX = 0.7;

function derivePromptThreshold(similarityThreshold: number): number {
  const looseness = Math.min(
    1,
    Math.max(0, (similarityThreshold - SIMILARITY_MIN) / SIMILARITY_SPAN),
  );
  const threshold =
    TEXT_LINK_THRESHOLD_STRICT +
    (TEXT_LINK_THRESHOLD_LOOSE - TEXT_LINK_THRESHOLD_STRICT) * looseness;
  return Number(threshold.toFixed(2));
}

export function SettingsView({
  settings,
  onUpdate,
  onReset,
  onClose,
  onResetHashes,
  isAnalyzing,
}: SettingsViewProps) {
  const [resetting, setResetting] = useState(false);
  const [ignoredDuplicates, setIgnoredDuplicates] = useState<string[]>([]);
  const [ignoredLoading, setIgnoredLoading] = useState(false);
  const [ignoredClearing, setIgnoredClearing] = useState(false);
  const [ignoredError, setIgnoredError] = useState<string | null>(null);
  const visualSliderValue = Number(
    (
      SIMILARITY_MAX -
      (settings.visualSimilarityThreshold - SIMILARITY_MIN)
    ).toFixed(0),
  );

  const sliderToSimilarityThreshold = (sliderValue: number): number =>
    SIMILARITY_MIN + (SIMILARITY_SPAN - (sliderValue - SIMILARITY_MIN));

  const handleBaseSimilarityChange = (nextSimilarity: number): void => {
    if (settings.useAdvancedSimilarityThresholds) {
      onUpdate({ similarityThreshold: nextSimilarity });
      return;
    }

    onUpdate({
      similarityThreshold: nextSimilarity,
      visualSimilarityThreshold: nextSimilarity,
      promptSimilarityThreshold: derivePromptThreshold(nextSimilarity),
    });
  };

  const handleSimilarityModeChange = (useAdvanced: boolean): void => {
    if (!useAdvanced) {
      onUpdate({ useAdvancedSimilarityThresholds: false });
      return;
    }

    const shouldBootstrapFromBasic =
      settings.visualSimilarityThreshold ===
        DEFAULTS.visualSimilarityThreshold &&
      settings.promptSimilarityThreshold === DEFAULTS.promptSimilarityThreshold;

    if (!shouldBootstrapFromBasic) {
      onUpdate({ useAdvancedSimilarityThresholds: true });
      return;
    }

    onUpdate({
      useAdvancedSimilarityThresholds: true,
      visualSimilarityThreshold: settings.similarityThreshold,
      promptSimilarityThreshold: derivePromptThreshold(
        settings.similarityThreshold,
      ),
    });
  };

  const loadIgnoredDuplicates = async () => {
    setIgnoredLoading(true);
    setIgnoredError(null);
    try {
      const rows = await window.image.listIgnoredDuplicates();
      setIgnoredDuplicates(rows);
    } catch (e: unknown) {
      setIgnoredError(
        e instanceof Error
          ? e.message
          : "무시 목록을 불러오는 중 오류가 발생했습니다.",
      );
    } finally {
      setIgnoredLoading(false);
    }
  };

  const handleResetAll = () => {
    onReset();
  };

  const handleReset = async () => {
    setResetting(true);
    await onResetHashes();
    setResetting(false);
  };

  const handleClearIgnoredDuplicates = async () => {
    setIgnoredClearing(true);
    setIgnoredError(null);
    try {
      await window.image.clearIgnoredDuplicates();
      await loadIgnoredDuplicates();
    } catch (e: unknown) {
      setIgnoredError(
        e instanceof Error
          ? e.message
          : "무시 목록 초기화 중 오류가 발생했습니다.",
      );
    } finally {
      setIgnoredClearing(false);
    }
  };

  useEffect(() => {
    void loadIgnoredDuplicates();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-lg space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SettingsIcon className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground select-none">
              설정
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetAll}
              className="text-xs h-8 gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              모든 설정 초기화
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["theme"])}>테마</SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            앱의 색상 테마를 선택합니다.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                onClick={() => onUpdate({ theme: theme.id })}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md border transition-colors",
                  settings.theme === theme.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
                )}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["pageSize"])}>
            페이지당 이미지 수
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            갤러리에서 한 번에 표시할 이미지 수입니다.
          </p>
          <OptionGroup
            value={settings.pageSize}
            options={[10, 20, 50, 100] as number[]}
            label={(v) => `${v}개`}
            onChange={(v) => onUpdate({ pageSize: v })}
          />
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["recentDays"])}>
            최근 생성 범위
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            최근 생성 뷰에서 표시할 기간입니다.
          </p>
          <OptionGroup
            value={settings.recentDays}
            options={[1, 3, 7, 14, 30, 60, 90] as number[]}
            label={(v) => `${v}일`}
            onChange={(v) => onUpdate({ recentDays: v })}
          />
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["similarPageSize"])}>
            유사 이미지 패널 페이지 크기
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            이미지 상세 화면의 유사 이미지 패널에서 한 페이지에 표시할 이미지
            수입니다.
          </p>
          <OptionGroup
            value={settings.similarPageSize}
            options={[5, 10, 20, 50] as number[]}
            label={(v) => `${v}개`}
            onChange={(v) => onUpdate({ similarPageSize: v })}
          />
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader
            onReset={() =>
              onReset([
                "similarityThreshold",
                "useAdvancedSimilarityThresholds",
                "visualSimilarityThreshold",
                "promptSimilarityThreshold",
              ])
            }
          >
            유사 이미지 설정
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            유사 이미지로 판단하는 강도를 설정합니다.
          </p>
          <div className="rounded-md border border-border/60 p-3 space-y-3">
            <div className="space-y-2">
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                role="radiogroup"
                aria-label="유사도 설정 모드"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!settings.useAdvancedSimilarityThresholds}
                  onClick={() => handleSimilarityModeChange(false)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    !settings.useAdvancedSimilarityThresholds
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border bg-secondary/20 hover:border-foreground/30 hover:bg-secondary/40",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-2.5 w-2.5 rounded-full",
                        !settings.useAdvancedSimilarityThresholds
                          ? "bg-primary"
                          : "bg-border",
                      )}
                    />
                    <p className="text-sm font-medium text-foreground">
                      기본 모드
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    대부분의 사용자에게 적합
                  </p>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.useAdvancedSimilarityThresholds}
                  onClick={() => handleSimilarityModeChange(true)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    settings.useAdvancedSimilarityThresholds
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border bg-secondary/20 hover:border-foreground/30 hover:bg-secondary/40",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-2.5 w-2.5 rounded-full",
                        settings.useAdvancedSimilarityThresholds
                          ? "bg-primary"
                          : "bg-border",
                      )}
                    />
                    <p className="text-sm font-medium text-foreground">
                      고급 모드
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Visual/Prompt 기준 개별 조정
                  </p>
                </button>
              </div>
            </div>

            <div className="rounded-md border border-border/50 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
              {settings.useAdvancedSimilarityThresholds
                ? `현재 적용: Visual ${settings.visualSimilarityThreshold} (${similarityQualityLabel(settings.visualSimilarityThreshold)}) · Prompt ${settings.promptSimilarityThreshold.toFixed(2)} (${jaccardLabel(settings.promptSimilarityThreshold)})`
                : `현재 적용: Visual ${settings.similarityThreshold} (${similarityQualityLabel(settings.similarityThreshold)}) · Prompt ${derivePromptThreshold(settings.similarityThreshold).toFixed(2)}`}
            </div>

            {!settings.useAdvancedSimilarityThresholds ? (
              <div className="space-y-3 border-t border-border/50 pt-3">
                {/* <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>기본 유사도: {settings.similarityThreshold}</span>
                  <span>
                    {similarityQualityLabel(settings.similarityThreshold)}
                  </span>
                </div> */}
                <OptionGroup
                  value={settings.similarityThreshold}
                  options={[16, 14, 12, 10, 8] as number[]}
                  label={(v) => `${similarityQualityLabel(v)}`}
                  onChange={(v) => handleBaseSimilarityChange(v)}
                />
                {/* <p className="text-[11px] text-muted-foreground/80">
                  대부분의 사용자에게 적합합니다.
                </p> */}
              </div>
            ) : (
              <div className="space-y-4 border-t border-border/50 pt-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {`Visual (Perceptual Hash): ${settings.visualSimilarityThreshold}`}
                    </span>
                    <span>
                      {similarityQualityLabel(
                        settings.visualSimilarityThreshold,
                      )}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={SIMILARITY_MIN}
                    max={SIMILARITY_MAX}
                    step={1}
                    value={visualSliderValue}
                    onChange={(e) =>
                      onUpdate({
                        visualSimilarityThreshold: sliderToSimilarityThreshold(
                          Number(e.target.value),
                        ),
                      })
                    }
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-secondary"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground/80">
                    <span>느슨 (16)</span>
                    <span>엄격 (8)</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Prompt (Jaccard):{" "}
                      {settings.promptSimilarityThreshold.toFixed(2)}
                    </span>
                    <span>
                      {jaccardLabel(settings.promptSimilarityThreshold)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={JACCARD_MIN}
                    max={JACCARD_MAX}
                    step={0.01}
                    value={settings.promptSimilarityThreshold}
                    onChange={(e) =>
                      onUpdate({
                        promptSimilarityThreshold: Number(
                          Number(e.target.value).toFixed(2),
                        ),
                      })
                    }
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-secondary"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground/80">
                    <span>느슨 (0.50)</span>
                    <span>엄격 (0.70)</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground select-none">
            해시 재계산
          </h2>
          <p className="text-xs text-muted-foreground select-none">
            유사 이미지 판별에 사용되는 Perceptual Hash를 초기화하고 다시
            계산합니다.
          </p>
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={resetting || isAnalyzing}
          >
            {resetting
              ? "초기화 중..."
              : isAnalyzing
                ? "계산 중..."
                : "초기화 및 재계산"}
          </Button>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground select-none">
            중복 무시 목록
          </h2>
          <p className="text-xs text-muted-foreground select-none">
            중복 처리에서 &quot;무시&quot;를 선택한 파일 목록입니다. 목록을
            초기화하면 다음 스캔/감시부터 다시 수집 대상이 됩니다.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadIgnoredDuplicates}
              disabled={ignoredLoading || ignoredClearing}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 mr-1.5",
                  ignoredLoading && "animate-spin",
                )}
              />
              새로고침
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearIgnoredDuplicates}
              disabled={ignoredClearing || ignoredLoading}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {ignoredClearing ? "초기화 중..." : "목록 초기화"}
            </Button>
          </div>
          {ignoredError && (
            <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
              {ignoredError}
            </p>
          )}
          <div className="rounded-md border border-border/60 bg-secondary/10">
            <div className="px-3 py-2 border-b border-border/60 text-xs text-muted-foreground">
              총 {ignoredDuplicates.length}개
            </div>
            <div className="max-h-40 overflow-auto px-3 py-2">
              {ignoredDuplicates.length === 0 ? (
                <p className="text-xs text-muted-foreground">비어 있습니다.</p>
              ) : (
                <ul className="space-y-1">
                  {ignoredDuplicates.map((filePath) => (
                    <li
                      key={filePath}
                      className="text-xs text-muted-foreground font-mono break-all"
                    >
                      {filePath}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
