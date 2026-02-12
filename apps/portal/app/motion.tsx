"use client";

import { AnimatePresence, type HTMLMotionProps, motion } from "framer-motion";
import type { ReactNode } from "react";

/* ── FadeUp ─────────────────────────────────────────────── */

type FadeUpProps = HTMLMotionProps<"div"> & {
  delay?: number;
  children: ReactNode;
};

export function FadeUp({ delay = 0, children, ...rest }: FadeUpProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* ── StaggerChildren ────────────────────────────────────── */

type StaggerProps = HTMLMotionProps<"div"> & {
  stagger?: number;
  children: ReactNode;
};

export function StaggerChildren({
  stagger = 0.1,
  children,
  ...rest
}: StaggerProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      variants={{
        visible: { transition: { staggerChildren: stagger } },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  ...rest
}: HTMLMotionProps<"div"> & { children: ReactNode }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.5, ease: "easeOut" },
        },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* ── Skeleton ───────────────────────────────────────────── */

type SkeletonProps = {
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: React.CSSProperties;
};

export function Skeleton({
  width = "100%",
  height = "1rem",
  className,
  style,
}: SkeletonProps) {
  return (
    <motion.div
      className={className}
      style={{
        width,
        height,
        borderRadius: 10,
        background: "rgba(15,23,42,0.06)",
        ...style,
      }}
      animate={{ opacity: [0.4, 1, 0.4] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/* ── PillPop ────────────────────────────────────────────── */

type PillPopProps = HTMLMotionProps<"span"> & { children: ReactNode };

export function PillPop({ children, ...rest }: PillPopProps) {
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      {...rest}
    >
      {children}
    </motion.span>
  );
}

/* ── PresenceCard ───────────────────────────────────────── */

type PresenceCardProps = HTMLMotionProps<"div"> & {
  show: boolean;
  children: ReactNode;
};

export function PresenceCard({ show, children, ...rest }: PresenceCardProps) {
  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          key="presence"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          {...rest}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
