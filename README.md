# gripper-lifetime-inspection

# Setup Environment
Run ```npm install``` to install dependencies. Ensure Node.js is installed on system.
Main script is avs_cognex.js, run ```node avs_cognex.js``` to establish connection with camera.
avs_cognex.js is programmed to trigger once immediately when starting the script. A second trigger occurs 4 seconds later.
Due to not having a PLC integrated in the robot cell, we decided to use the cycle time of the Airfoil Lifetime robot sequence as a way to trigger for images.
Therefore, run the avs_cognex.js file when the robot has reached CamPartView1 robtarget. This will synchronize the camera triggers with the robot sequence.
Note: A PLC should be used to trigger the camera, not a timer! ResultsChanged will still fire if the camera is triggered via 24V signal


MICHAEL COX, WILL WYSE, KARISSA WIGGINS
