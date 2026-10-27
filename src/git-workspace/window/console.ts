/**
 * Console pane: the commands the Host actually executed, newest first.
 * @module dsh-session-map/git-workspace/window/console
 */
import * as React from 'react'
import type { CommandReceipt } from '../git-types'

/** Console props. */
export interface ConsolePaneProps {
  readonly commands: readonly CommandReceipt[]
}

/** Render the console tab. */
export function ConsolePane(props: ConsolePaneProps): React.ReactElement {
  if (props.commands.length === 0) {
    return React.createElement(
      'div',
      { className: 'dgw-empty' },
      React.createElement('div', { className: 'dgw-emptyBox' },
        React.createElement('div', null, '还没有执行过 git 命令'),
        React.createElement('div', null, '刷新、查看日志或打开提交详情后，实际执行的命令会显示在这里。'),
      ),
    )
  }
  const rows = [...props.commands].reverse()
  return React.createElement(
    'div',
    { className: 'dgw-console' },
    React.createElement('div', { className: 'dgw-rows' },
      ...rows.map((command, index) => React.createElement(
        'div',
        { className: 'dgw-consoleRow', key: `${index}-${command.argv.join(' ')}`, title: command.argv.join(' ') },
        React.createElement(
          'span',
          { className: command.exitCode === 0 ? 'dgw-consoleExit' : 'dgw-consoleExit dgw-consoleExit--fail' },
          command.cancelled === true ? 'cancel' : `exit ${String(command.exitCode)}`,
        ),
        React.createElement('span', { className: 'dgw-consoleArgv' }, command.argv.join(' ')),
        command.truncated === true
          ? React.createElement('span', { className: 'dgw-consoleMs' }, 'truncated')
          : null,
        React.createElement('span', { className: 'dgw-consoleMs' }, `${command.ms} ms`),
      )),
    ),
  )
}
