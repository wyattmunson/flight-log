import '../env';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { prisma } from '../db';
import { UserAdminError, adoptDefaultUser, createUser, setUserPassword } from './users';

/**
 *   tsx src/auth/cli.ts create --email <e> --name <n>
 *   tsx src/auth/cli.ts create --adopt-default --email <e> [--name <n>] [--force]
 *   tsx src/auth/cli.ts set-password --email <e>
 * (via `npm run user:create -- …` / `npm run user:set-password -- …`). The password is prompted for
 * twice without echo on a TTY, otherwise one line is read from stdin. It is never printed.
 */

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stderr.write('\n');
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish(() => resolve(value));
        if (ch === '\u0003') return finish(() => reject(new UserAdminError('Cancelled')));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) {
    const first = await readHidden('Password: ');
    const second = await readHidden('Confirm password: ');
    if (first !== second) throw new UserAdminError('Passwords do not match');
    return first;
  }
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  throw new UserAdminError('No password on stdin');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'adopt-default': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  });
  if (!values.email) throw new UserAdminError('--email is required');

  if (command === 'create') {
    if (!values['adopt-default'] && !values.name)
      throw new UserAdminError('--name is required (or use --adopt-default)');
    const password = await readPassword();
    const user = values['adopt-default']
      ? await adoptDefaultUser({
          email: values.email,
          name: values.name,
          password,
          force: values.force,
        })
      : await createUser({ email: values.email, name: values.name ?? '', password });
    console.log(
      `[user] ${values['adopt-default'] ? 'adopted default user as' : 'created'} ${user.email} (${user.id})`,
    );
  } else if (command === 'set-password') {
    const user = await setUserPassword({ email: values.email, password: await readPassword() });
    console.log(`[user] password updated for ${user.email}; existing sessions signed out`);
  } else {
    throw new UserAdminError(`Unknown command "${command ?? ''}" (use create or set-password)`);
  }
}

main()
  .catch((e) => {
    // Only our own messages are printed; they never contain the password or hash.
    console.error(
      `[user] ${e instanceof UserAdminError ? e.message : `failed unexpectedly (${e instanceof Error ? e.name : 'error'})`}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
