import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn, signUp, authErrorMessage } from '../lib/auth-client';
import { Button } from '../components/ui/Button';
import { Field, TextInput } from '../components/ui/primitives';
import { cn } from '../lib/cn';

const signInSchema = z.object({
  email: z.string().trim().email('That does not look like an email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(1, 'What should we call you?').max(60),
  password: z.string().min(10, 'Use at least 10 characters.').max(128),
});

type Mode = 'signin' | 'signup';

export function SignInScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<{ name?: string; email: string; password: string }>({
    resolver: zodResolver(mode === 'signup' ? signUpSchema : signInSchema),
    mode: 'onBlur',
  });

  const submitting = form.formState.isSubmitting;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);

    const result =
      mode === 'signup'
        ? await signUp.email({
            name: values.name ?? '',
            email: values.email,
            password: values.password,
          })
        : await signIn.email({ email: values.email, password: values.password });

    if (result.error) {
      setFormError(
        authErrorMessage(
          result.error.code,
          mode === 'signup' ? 'We could not create that account.' : 'We could not sign you in.',
        ),
      );
      return;
    }

    // A full navigation, so the session cookie is definitely in play for
    // every request the app makes from here.
    window.location.href = '/';
  });

  return (
    <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[440px] flex-col justify-center px-5 py-10">
      <div className="animate-rise">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-[18px] bg-accent text-white shadow-[0_8px_28px_-8px_rgb(88_86_214/0.6)]">
            <span className="text-[24px] font-semibold">₹</span>
          </div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em]">
            Your money, finally organised.
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
            Cash, bank, savings, what you lent and what you owe — all of it, always adding up.
          </p>
        </div>

        <div className="card p-5">
          <div className="mb-5 grid grid-cols-2 gap-0.5 rounded-md bg-surface-sunken p-1">
            {(
              [
                ['signin', 'Sign in'],
                ['signup', 'Create account'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setFormError(null);
                  form.clearErrors();
                }}
                className={cn(
                  'h-9 rounded-[10px] text-[14px] font-medium transition-colors duration-200 ease-out',
                  mode === value
                    ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(16_16_26/0.1)]'
                    : 'text-ink-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3.5" noValidate>
            {mode === 'signup' && (
              <Field label="Name" error={form.formState.errors.name?.message}>
                <TextInput
                  {...form.register('name')}
                  placeholder="Your name"
                  autoComplete="name"
                  autoFocus
                />
              </Field>
            )}

            <Field label="Email" error={form.formState.errors.email?.message}>
              <TextInput
                {...form.register('email')}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                inputMode="email"
                autoFocus={mode === 'signin'}
              />
            </Field>

            <Field
              label="Password"
              error={form.formState.errors.password?.message}
              hint={mode === 'signup' ? 'At least 10 characters.' : undefined}
            >
              <TextInput
                {...form.register('password')}
                type="password"
                placeholder="••••••••••"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </Field>

            {formError && (
              <p role="alert" className="animate-fade rounded-md bg-negative-soft px-3.5 py-2.5 text-[13.5px] text-negative">
                {formError}
              </p>
            )}

            <Button type="submit" block size="lg" loading={submitting}>
              {mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12.5px] leading-relaxed text-ink-faint">
          Your ledger is private to you. Nothing is shared, and nothing is sold.
        </p>
      </div>
    </div>
  );
}
