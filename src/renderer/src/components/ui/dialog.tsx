import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;
const DialogDescription = DialogPrimitive.Description;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

type DialogContentProps = React.ComponentProps<
  typeof DialogPrimitive.Content
> & {
  closeDisabled?: boolean;
  hideCloseButton?: boolean;
};

function hasDialogDescription(node: React.ReactNode): boolean {
  return React.Children.toArray(node).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (child.type === DialogPrimitive.Description) return true;
    const childNode = (child.props as { children?: React.ReactNode }).children;
    return hasDialogDescription(childNode);
  });
}

function DialogContent(rawProps: DialogContentProps) {
  const hasAriaDescribedByProp = Object.prototype.hasOwnProperty.call(
    rawProps,
    "aria-describedby",
  );
  const {
    className,
    children,
    closeDisabled = false,
    hideCloseButton = false,
    "aria-describedby": ariaDescribedBy,
    ...props
  } = rawProps;
  const shouldInjectFallbackDescription =
    !hasAriaDescribedByProp && !hasDialogDescription(children);

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        {...(hasAriaDescribedByProp
          ? { "aria-describedby": ariaDescribedBy }
          : {})}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-background border border-border rounded-xl shadow-xl p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
        {shouldInjectFallbackDescription && (
          <DialogPrimitive.Description className="sr-only">
            Dialog content
          </DialogPrimitive.Description>
        )}
        {!hideCloseButton && (
          <DialogPrimitive.Close
            disabled={closeDisabled}
            className={cn(
              "absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5 mb-6 select-none", className)}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex justify-end gap-2 mt-6", className)} {...props} />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
};
