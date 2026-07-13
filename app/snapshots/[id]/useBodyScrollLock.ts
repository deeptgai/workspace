"use client";

import { useEffect } from "react";

type BodyScrollState = {
  bodyLeft: string;
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  bodyPaddingRight: string;
  bodyPosition: string;
  bodyRight: string;
  bodyTop: string;
  bodyWidth: string;
  documentOverscrollBehavior: string;
  scrollY: number;
};

let lockCount = 0;
let lockedState: BodyScrollState | null = null;

function lockBodyScroll() {
  lockCount += 1;

  if (lockCount > 1) {
    return unlockBodyScroll;
  }

  const body = document.body;
  const documentElement = document.documentElement;
  const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

  lockedState = {
    bodyLeft: body.style.left,
    bodyOverflow: body.style.overflow,
    bodyOverscrollBehavior: body.style.overscrollBehavior,
    bodyPaddingRight: body.style.paddingRight,
    bodyPosition: body.style.position,
    bodyRight: body.style.right,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    documentOverscrollBehavior: documentElement.style.overscrollBehavior,
    scrollY: window.scrollY,
  };

  body.style.left = "0";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  body.style.position = "fixed";
  body.style.right = "0";
  body.style.top = `-${lockedState.scrollY}px`;
  body.style.width = "100%";
  documentElement.style.overscrollBehavior = "none";

  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }

  return unlockBodyScroll;
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);

  if (lockCount > 0 || !lockedState) {
    return;
  }

  const body = document.body;
  const documentElement = document.documentElement;
  const state = lockedState;
  lockedState = null;

  body.style.left = state.bodyLeft;
  body.style.overflow = state.bodyOverflow;
  body.style.overscrollBehavior = state.bodyOverscrollBehavior;
  body.style.paddingRight = state.bodyPaddingRight;
  body.style.position = state.bodyPosition;
  body.style.right = state.bodyRight;
  body.style.top = state.bodyTop;
  body.style.width = state.bodyWidth;
  documentElement.style.overscrollBehavior = state.documentOverscrollBehavior;

  window.scrollTo(0, state.scrollY);
}

export function useBodyScrollLock(locked = true) {
  useEffect(() => {
    if (!locked) {
      return;
    }

    return lockBodyScroll();
  }, [locked]);
}
