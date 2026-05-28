# Stress State & Yield Criteria
**A Reference Guide for Component Design**

---

## Introduction
This document serves as a consolidated reference guide for evaluating the stress state of a designed component. It connects the concepts of Mohr's Circle (stress transformation) with failure theories for ductile materials, specifically the Von Mises and Tresca yield criteria. This framework is essential when building a tool to calculate and evaluate safety margins in structural design.

## Mohr's Circle & Principal Stresses
Before evaluating whether a material will yield, any complex 3D or 2D stress state must be simplified into its fundamental components: **Principal Stresses** ($\sigma_1, \sigma_2, \sigma_3$).

Mohr's Circle is a graphical representation of the state of stress. It transforms applied normal and shear stresses ($\sigma_x, \sigma_y, \tau_{xy}$) into principal stresses, which are the maximum and minimum normal stresses acting on planes where the shear stress is zero. 

For a 2D plane stress state, the principal stresses are calculated as:

$$\sigma_{1,2} = \frac{\sigma_x + \sigma_y}{2} \pm \sqrt{\left(\frac{\sigma_x - \sigma_y}{2}\right)^2 + \tau_{xy}^2}$$

Once $\sigma_1$ and $\sigma_2$ are found (with $\sigma_3 = 0$ for plane stress), these values are fed into a yield criterion to determine failure.

## The Von Mises Yield Criterion
The Von Mises criterion, or *Maximum Distortion Energy Theory*, dictates that a ductile material yields when its distortion energy reaches a critical value. It incorporates all three principal stresses, meaning it accounts for the entire 3D state of stress.

### The Equation
The Von Mises stress ($\sigma_v$) for a 3D stress state is:

$$\sigma_v = \sqrt{\frac{(\sigma_1 - \sigma_2)^2 + (\sigma_2 - \sigma_3)^2 + (\sigma_3 - \sigma_1)^2}{2}}$$

For a 2D plane stress state ($\sigma_3 = 0$), this simplifies to:

$$\sigma_v = \sqrt{\sigma_1^2 - \sigma_1\sigma_2 + \sigma_2^2}$$

Yielding occurs when $\sigma_v \geq \sigma_Y$ (the tensile yield strength of the material).

### Connection to Mohr's Circle
The terms $(\sigma_1 - \sigma_2)$, $(\sigma_2 - \sigma_3)$, and $(\sigma_3 - \sigma_1)$ in the 3D equation are the exact **diameters of the three 3D Mohr's circles**. Thus, Von Mises stress is proportional to the root-mean-square of these diameters, providing an "average" assessment of the shear driving the distortion.

## The Tresca Yield Criterion
The Tresca criterion, or *Maximum Shear Stress Theory*, takes a simpler, more conservative approach. It assumes yielding occurs the instant the **absolute maximum shear stress** ($\tau_{max}$) reaches a critical limit, regardless of intermediate stresses.

### The Equation
$$\tau_{max} = \frac{\sigma_1 - \sigma_3}{2}$$

On a 3D Mohr's plot, this $\tau_{max}$ is simply the **radius of the largest circle**. Tresca completely ignores the intermediate principal stress ($\sigma_2$) and the two smaller circles.

## Graphical Representation (2D Plane Stress)
When plotting the boundaries of these criteria on a graph of $\sigma_1$ vs. $\sigma_2$ (where the boundary represents the onset of yielding, $\sigma_v = \sigma_Y$):

* **Tresca forms a rigid hexagon.**
* **Von Mises forms a continuous ellipse** that circumscribes the Tresca hexagon.

> **Defining the Ellipse Boundary:**
> The Von Mises ellipse equation is $\sigma_1^2 - \sigma_1\sigma_2 + \sigma_2^2 = \sigma_Y^2$. 
> 
> The $-\sigma_1\sigma_2$ term rotates the ellipse by 45 degrees. Its major axis lies along $\sigma_1 = \sigma_2$ (hydrostatic stress, where materials can withstand high loads without shearing), and its minor axis lies along $\sigma_1 = -\sigma_2$ (pure shear, where materials yield quickly).

## Clarifying the "Shear Only" Misconception
A common misconception is that falling outside the Tresca hexagon means a material fails in "shear only," while Von Mises represents a different failure mode.

**Reality:** For ductile materials (like steel or aluminum), yielding is *always* a shear-driven process. At the microscopic level, yielding is the sliding or slipping of crystal planes past one another, caused exclusively by shear stress. 

* **Tresca** is highly conservative. It only looks at the absolute maximum shear stress and assumes failure when that single metric exceeds the limit.
* **Von Mises** is considered more accurate for ductile materials. It recognizes that the intermediate principal stresses can interact in a way that restricts those crystal planes from slipping as easily, meaning the material can sometimes handle slightly more stress before yielding than Tresca predicts.

---
*Use this guide as the theoretical foundation for your stress calculation tool. By calculating $\sigma_1$ and $\sigma_2$ from your applied loads, and verifying that the resulting $\sigma_v$ is less than your material's $\sigma_Y$ (ideally with an applied factor of safety), you can confidently design safe components.*
