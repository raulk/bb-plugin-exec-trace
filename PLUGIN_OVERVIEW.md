# Exec profiler

See what agent scripts actually do: subprocesses launched and files opened
inside Python, Bash, and Node — attributed per operation type with no model
opt-in.

BB records the outer tool call; this plugin instruments the runtimes
transparently (`PYTHONPATH` sitecustomize with `sys.addaudithook`,
`BASH_ENV` xtrace, `NODE_OPTIONS` preload) and attributes inner spans to the
outer call by thread + time overlap. Anything it can't observe (containers,
`python -S`, remote shells) stays in an explicit opaque bucket — never guessed.
