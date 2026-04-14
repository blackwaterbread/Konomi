export function getPromptWeightToneClass(weight: number): string {
  if (weight >= 1.3) return "bg-warning/15 text-warning";
  if (weight > 1.0) return "bg-primary/15 text-primary";
  if (weight < 0) return "bg-destructive/15 text-destructive";
  if (weight < 0.75) return "bg-info/15 text-info";
  if (weight < 1.0) return "bg-group/14 text-group";
  return "bg-muted text-foreground/80";
}

export function getPromptWeightRawHighlightClass(weight: number): string {
  if (weight >= 1.3) return "bg-warning/45";
  if (weight > 1.0) return "bg-primary/40";
  if (weight < 0) return "bg-destructive/40";
  if (weight < 0.75) return "bg-info/40";
  if (weight < 1.0) return "bg-group/38";
  return "bg-muted";
}
