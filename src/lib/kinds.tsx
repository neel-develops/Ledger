import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  HandCoins,
  PiggyBank,
  Receipt,
  RotateCcw,
  Scale,
  Undo2,
  UserRoundMinus,
  UserRoundPlus,
  Users,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { TransactionKind } from '@shared/domain';

/**
 * How each transaction kind presents itself. Colour is used only to signal
 * direction (money out, money in, neither) — never for decoration.
 */

export type Tone = 'neutral' | 'accent' | 'positive' | 'negative';

interface KindMeta {
  label: string;
  /** What the user is trying to do, in their words. */
  description: string;
  icon: ReactNode;
  tone: Tone;
  /** Sign shown in front of the amount in a list. */
  direction: 'out' | 'in' | 'none';
}

export const KIND_META: Record<TransactionKind, KindMeta> = {
  expense: {
    label: 'Expense',
    description: 'Money went out',
    icon: <ArrowUpRight />,
    tone: 'negative',
    direction: 'out',
  },
  income: {
    label: 'Received',
    description: 'Money came in',
    icon: <ArrowDownLeft />,
    tone: 'positive',
    direction: 'in',
  },
  transfer: {
    label: 'Transfer',
    description: 'Move between accounts',
    icon: <ArrowLeftRight />,
    tone: 'accent',
    direction: 'none',
  },
  lend: {
    label: 'Someone owes me',
    description: 'They owe you',
    icon: <UserRoundPlus />,
    tone: 'accent',
    direction: 'out',
  },
  borrow: {
    label: 'I owe someone',
    description: 'You owe them',
    icon: <UserRoundMinus />,
    tone: 'accent',
    direction: 'in',
  },
  settle_receivable: {
    label: 'They paid me back',
    description: 'Money you were owed came back',
    icon: <HandCoins />,
    tone: 'positive',
    direction: 'in',
  },
  settle_payable: {
    label: 'I paid them back',
    description: 'Settle what you owe',
    icon: <Scale />,
    tone: 'neutral',
    direction: 'out',
  },
  paid_for_someone: {
    label: 'Paid for someone',
    description: 'You paid, they owe',
    icon: <Users />,
    tone: 'accent',
    direction: 'out',
  },
  someone_paid_for_me: {
    label: 'Someone paid for me',
    description: 'They paid, you owe',
    icon: <Receipt />,
    tone: 'accent',
    direction: 'none',
  },
  refund: {
    label: 'Refund',
    description: 'Money came back',
    icon: <Undo2 />,
    tone: 'positive',
    direction: 'in',
  },
  reversal: {
    label: 'Reversal',
    description: 'Undoes an earlier entry',
    icon: <RotateCcw />,
    tone: 'neutral',
    direction: 'none',
  },
  adjustment: {
    label: 'Adjustment',
    description: 'Corrects a cash count',
    icon: <Scale />,
    tone: 'neutral',
    direction: 'none',
  },
  opening_balance: {
    label: 'Starting balance',
    description: 'Money you already had',
    icon: <Wallet />,
    tone: 'neutral',
    direction: 'in',
  },
};

/** The savings shortcut is a transfer underneath, but users think of it as saving. */
export const SAVINGS_ACTION = {
  label: 'Savings',
  description: 'Move to savings',
  icon: <PiggyBank />,
  tone: 'accent' as Tone,
};

/**
 * A hue per kind, for the neon surfaces: tinted icons in light mode, glowing
 * ones in dark. Separate from `tone`, which stays the quiet direction signal.
 */
export const KIND_HUES: Record<TransactionKind, string> = {
  expense: '#ff5d73',
  income: '#34d399',
  transfer: '#5b8cff',
  lend: '#ffb547',
  borrow: '#ff7ad9',
  settle_receivable: '#2fd3e0',
  settle_payable: '#a3a8ff',
  paid_for_someone: '#ff8c42',
  someone_paid_for_me: '#7ee07e',
  refund: '#34d399',
  reversal: '#8e8e98',
  adjustment: '#8e8e98',
  opening_balance: '#b06bff',
};

export const SAVINGS_HUE = '#b06bff';
