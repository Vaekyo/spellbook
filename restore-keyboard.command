#!/bin/bash
# Emergency: removes ALL custom key remapping (hidutil) and gives you a normal keyboard back.
hidutil property --set '{"UserKeyMapping":[]}' && echo "Keyboard restored." 
rm -f "$(dirname "$0")/data/keyboard-remap.json"
sleep 2
