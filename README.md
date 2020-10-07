# VSCode Byebug Debugger

A very simple debugger that connects Visual Studio Code's debug system to
[byebug-dap](https://rubygems.org/gems/byebug-dap).

All debugging functionality is handled by `byebug-dap`. All issues should be
reported on the [byebug-dap project](https://gitlab.com/firelizzard/byebug-dap),
unless they are related to launching the debugger.

## Features

The VSCode Byebug Debugger defines the `ruby-byebug` debugger. For a complete
list of features, see the [byebug-dap
project](https://gitlab.com/firelizzard/byebug-dap). As of `byebug-dap` version
0.1.0, the supported feature set is minimal.

## Requirements

Either `gem install byebug-dap` or add `byebug-dap` to your Gemfile and `bundle install`.
