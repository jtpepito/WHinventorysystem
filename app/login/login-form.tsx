'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginAction } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
      </div>
      {state?.error && (
        <p data-testid="form-message" role="alert" className="text-sm text-red-700">{state.error}</p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}
