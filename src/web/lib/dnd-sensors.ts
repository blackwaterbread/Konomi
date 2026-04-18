import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useIsMobile } from "@/hooks/useBreakpoint";

const DESKTOP_CONSTRAINT = { distance: 6 } as const;
const MOBILE_CONSTRAINT = { delay: 250, tolerance: 8 } as const;

export function useDndPointerSensors() {
  const isMobile = useIsMobile();
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isMobile ? MOBILE_CONSTRAINT : DESKTOP_CONSTRAINT,
    }),
  );
}
