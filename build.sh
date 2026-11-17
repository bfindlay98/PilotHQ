#!/bin/sh
# Builds one self-contained file (PilotHQ.html) from index.html + the three scripts. Open it by double-clicking.
cd "$(dirname "$0")"
awk '
/<script src="data.js"><\/script>/   { print "<script>"; system("cat data.js");   print "</script>"; next }
/<script src="engine.js"><\/script>/ { print "<script>"; system("cat engine.js"); print "</script>"; next }
/<script src="app.js"><\/script>/    { print "<script>"; system("cat app.js");    print "</script>"; next }
{ print }' index.html > PilotHQ.html
echo "Built PilotHQ.html"
